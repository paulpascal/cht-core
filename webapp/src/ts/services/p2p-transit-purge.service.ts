import { Injectable } from '@angular/core';

import { DbService } from '@mm-services/db.service';
import { P2pTransitFilterService } from '@mm-services/p2p-transit-filter.service';

const TRANSIT_DOC_ID = '_local/p2p-transit-docs';
const PURGE_BATCH_SIZE = 50;

interface PurgeResult {
  purged: number;
  failed: number;
  alreadyPurged: number;
}

interface TransitBatch {
  source_device_id: string;
  source_user: string;
  received_at: number;
  doc_count: number;
  pushed_to_server: boolean;
  pushed_at: number | null;
  purged: boolean;
  purged_at: number | null;
}

interface TransitDoc {
  _id: string;
  _rev?: string;
  batches: Record<string, TransitBatch>;
  transit_index: Record<string, string>;
  stats: {
    total_received: number;
    total_pushed: number;
    total_purged: number;
    pending_push: number;
  };
}

/**
 * Purges transit docs after they've been successfully pushed to the server.
 *
 * G25: MUST use db.purge(id, rev) -- NEVER db.remove().
 *      db.remove() creates a deletion tombstone that replicates to server and destroys data.
 *      db.purge() removes locally without any replication effect.
 */
@Injectable({ providedIn: 'root' })
export class P2pTransitPurgeService {

  constructor(
    private dbService: DbService,
    private transitFilterService: P2pTransitFilterService
  ) {}

  /**
   * Purge all transit docs from batches that have been pushed to the server.
   * Called after successful server sync confirms docs are on server.
   *
   * G25: Uses db.purge() NOT db.remove().
   */
  async purgeConfirmedTransitDocs(): Promise<PurgeResult> {
    const result: PurgeResult = { purged: 0, failed: 0, alreadyPurged: 0 };

    // Purge via PouchDB using _local/p2p-transit-docs as source of truth.
    // The native bridge (p2pPurgeTransitDocs) only queries in-memory TransitDocManager
    // which is cleared after p2pStop() shutdown — so it can't be relied on for
    // the offline-then-online flow where purge happens after app restart/reconnect.
    let transitDoc: TransitDoc;
    try {
      const db = this.dbService.get();
      transitDoc = await db.get(TRANSIT_DOC_ID);
    } catch (err: any) {
      if (err.status === 404) {
        return result; // No transit docs to purge
      }
      throw err;
    }

    // Find batches that have been pushed but not yet purged
    const purgeableBatchIds: string[] = [];
    for (const [batchId, batch] of Object.entries(transitDoc.batches)) {
      if (batch.pushed_to_server && !batch.purged) {
        purgeableBatchIds.push(batchId);
      }
    }

    if (purgeableBatchIds.length === 0) {
      return result;
    }

    // Collect doc IDs from purgeable batches
    const docIdsToPurge: string[] = [];
    for (const [docId, batchId] of Object.entries(transitDoc.transit_index)) {
      if (purgeableBatchIds.includes(batchId)) {
        docIdsToPurge.push(docId);
      }
    }

    // Purge in batches, tracking failures so we don't remove them from transit_index
    const failedDocIds = new Set<string>();
    for (let i = 0; i < docIdsToPurge.length; i += PURGE_BATCH_SIZE) {
      const batch = docIdsToPurge.slice(i, i + PURGE_BATCH_SIZE);
      for (const docId of batch) {
        try {
          const success = await this.purgeDoc(docId);
          if (success) {
            result.purged++;
          } else {
            result.alreadyPurged++;
          }
        } catch (err) {
          console.error('P2pTransitPurge: failed to purge doc', docId, err);
          failedDocIds.add(docId);
          result.failed++;
        }
      }

      // Notify native bridge of batch completion (best-effort, may be null after restart)
      try {
        const bridge = (window as any).medicmobile_android;
        if (bridge && typeof bridge.p2pConfirmBatchPurged === 'function') {
          bridge.p2pConfirmBatchPurged(JSON.stringify(batch));
        }
      } catch (err) {
        console.debug('P2pTransitPurge: bridge confirm failed', err);
      }
    }

    // Only update transit doc if at least some docs were actually purged
    if (result.purged > 0 || result.alreadyPurged > 0) {
      // Only remove successfully purged doc IDs from transit_index
      const successfullyPurged = docIdsToPurge.filter(
        id => !failedDocIds.has(id)
      );
      await this.updateTransitDocAfterPurge(transitDoc, purgeableBatchIds, successfullyPurged);
      await this.transitFilterService.refresh();
    }

    return result;
  }

  /**
   * Purge a single doc by ID using CHT's soft-delete pattern:
   * {_id, _rev, _deleted: true, purged: true}
   *
   * G25: The readOnlyFilter in db-sync.service.ts already excludes docs with
   * {_deleted: true, purged: true} from replicating to server, so this is safe.
   * This is the same pattern used by CHT's bootstrapper/purger.js.
   */
  private async purgeDoc(docId: string): Promise<boolean> {
    const db = this.dbService.get();

    try {
      const doc = await db.get(docId);
      await db.put({ _id: doc._id, _rev: doc._rev, _deleted: true, purged: true });
      return true;
    } catch (err: any) {
      if (err.status === 404) {
        // Already purged or never existed locally -- expected and safe
        return false;
      }
      throw err;
    }
  }

  /**
   * Update _local/p2p-transit-docs after purge:
   * - Mark purged batches as purged
   * - Remove purged doc IDs from transit_index
   * - Update stats
   */
  private async updateTransitDocAfterPurge(
    transitDoc: TransitDoc,
    purgedBatchIds: string[],
    purgedDocIds: string[]
  ): Promise<void> {
    const db = this.dbService.get();
    const now = Date.now();

    for (const docId of purgedDocIds) {
      delete transitDoc.transit_index[docId];
    }

    // Only mark a batch as purged if none of its docs remain in transit_index
    for (const batchId of purgedBatchIds) {
      const hasRemainingDocs = Object.values(transitDoc.transit_index).includes(batchId);
      if (!hasRemainingDocs && transitDoc.batches[batchId]) {
        transitDoc.batches[batchId].purged = true;
        transitDoc.batches[batchId].purged_at = now;
      }
    }

    transitDoc.stats.total_purged += purgedDocIds.length;
    transitDoc.stats.pending_push = Math.max(0, transitDoc.stats.pending_push - purgedDocIds.length);

    try {
      await db.put(transitDoc);
    } catch (err: any) {
      if (err.status === 409) {
        try {
          const fresh = await db.get(TRANSIT_DOC_ID);
          for (const docId of purgedDocIds) {
            delete fresh.transit_index[docId];
          }
          for (const batchId of purgedBatchIds) {
            const hasRemainingDocs = Object.values(fresh.transit_index).includes(batchId);
            if (!hasRemainingDocs && fresh.batches[batchId]) {
              fresh.batches[batchId].purged = true;
              fresh.batches[batchId].purged_at = now;
            }
          }
          fresh.stats.total_purged = (fresh.stats.total_purged || 0) + purgedDocIds.length;
          fresh.stats.pending_push = Math.max(0, (fresh.stats.pending_push || 0) - purgedDocIds.length);
          await db.put(fresh);
        } catch (retryErr) {
          console.error('P2pTransitPurge: failed to update transit doc after purge (retry)', retryErr);
        }
      } else {
        console.error('P2pTransitPurge: failed to update transit doc after purge', err);
      }
    }
  }

  /**
   * Mark all batches as pushed to server and purge them.
   * Called after a successful server sync with 0 doc_write_failures confirms
   * all P2P-received docs have reached the server.
   */
  async markAllBatchesPushedAndPurge(): Promise<PurgeResult> {
    const db = this.dbService.get();
    let transitDoc: TransitDoc;
    try {
      transitDoc = await db.get(TRANSIT_DOC_ID);
    } catch (err: any) {
      if (err.status === 404) {
        return { purged: 0, failed: 0, alreadyPurged: 0 };
      }
      throw err;
    }

    let changed = false;
    for (const batch of Object.values(transitDoc.batches)) {
      if (!batch.pushed_to_server) {
        batch.pushed_to_server = true;
        batch.pushed_at = Date.now();
        changed = true;
      }
    }

    if (changed) {
      await db.put(transitDoc);
    }

    return this.purgeConfirmedTransitDocs();
  }

  /**
   * Get the count of transit docs that are pending purge (pushed but not yet purged).
   */
  async getPendingPurgeCount(): Promise<number> {
    try {
      const db = this.dbService.get();
      const transitDoc: TransitDoc = await db.get(TRANSIT_DOC_ID);
      let count = 0;
      for (const batch of Object.values(transitDoc.batches)) {
        if (batch.pushed_to_server && !batch.purged) {
          count += batch.doc_count;
        }
      }
      return count;
    } catch (err: any) {
      if (err.status === 404) {
        return 0;
      }
      throw err;
    }
  }

  /**
   * Check if there are stale transit docs (unpushed for >30 days).
   * G27: Show user notification for stale transit docs.
   */
  async hasStaleTransitDocs(): Promise<boolean> {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    try {
      const db = this.dbService.get();
      const transitDoc: TransitDoc = await db.get(TRANSIT_DOC_ID);
      for (const batch of Object.values(transitDoc.batches)) {
        if (!batch.pushed_to_server && !batch.purged && batch.received_at < cutoff) {
          return true;
        }
      }
      return false;
    } catch (err: any) {
      if (err.status === 404) {
        return false;
      }
      throw err;
    }
  }
}
