import { Component, OnInit } from '@angular/core';
import { NgIf, NgFor, DatePipe } from '@angular/common';
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent, MatCardSubtitle } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { TranslateDirective, TranslatePipe } from '@ngx-translate/core';

import { DbService } from '@mm-services/db.service';
import { P2pConfigService } from '@mm-services/p2p-config.service';
import { ToolBarComponent } from '@mm-components/tool-bar/tool-bar.component';

const SYNC_LOG_ID = '_local/p2p-sync-log';
const RELAY_LOG_ID = '_local/p2p-relay-log';

interface SyncSession {
  session_id: string;
  peer_device_id: string;
  peer_user: string;
  started_at: number;
  completed_at: number;
  docs_pushed: number;
  docs_pulled: number;
  bytes_transferred: number;
  status: SessionStatus;
  error: string | null;
}

type SessionStatus = 'completed' | 'failed' | 'interrupted';

interface RelaySession {
  session_id: string;
  source_device_id: string;
  source_user: string;
  started_at: number;
  completed_at: number;
  docs_received: number;
  in_scope_count: number;
  transit_count: number;
  rejected_count: number;
  bytes_received: number;
  status: SessionStatus;
}

interface HistoryEntry {
  session_id: string;
  type: 'sync' | 'relay';
  peer: string;
  started_at: number;
  completed_at: number;
  docs_count: number;
  transit_count: number;
  bytes: number;
  status: SessionStatus;
  error: string | null;
}

@Component({
  selector: 'p2p-history',
  templateUrl: './p2p-history.component.html',
  imports: [
    NgIf,
    NgFor,
    DatePipe,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatCardSubtitle,
    MatIcon,
    MatChipsModule,
    TranslateDirective,
    TranslatePipe,
    ToolBarComponent,
  ],
})
export class P2pHistoryComponent implements OnInit {
  history: HistoryEntry[] = [];
  loading = true;
  isSupervisor = false;

  // Aggregate stats
  totalSessions = 0;
  totalDocsSynced = 0;
  totalBytesTransferred = 0;
  totalTransitDocs = 0;

  constructor(
    private readonly dbService: DbService,
    private readonly p2pConfigService: P2pConfigService
  ) {}

  async ngOnInit() {
    const role = await this.p2pConfigService.getUserP2pRole();
    this.isSupervisor = role === 'host';
    this.loadHistory();
  }

  private mapSyncSession(s: SyncSession): HistoryEntry {
    return {
      session_id: s.session_id,
      type: 'sync',
      peer: s.peer_user || s.peer_device_id,
      started_at: s.started_at,
      completed_at: s.completed_at,
      docs_count: (s.docs_pushed || 0) + (s.docs_pulled || 0),
      transit_count: 0,
      bytes: s.bytes_transferred || 0,
      status: s.status,
      error: s.error || null,
    };
  }

  private mapRelaySession(s: RelaySession): HistoryEntry {
    return {
      session_id: s.session_id,
      type: 'relay',
      peer: s.source_user || s.source_device_id,
      started_at: s.started_at,
      completed_at: s.completed_at,
      docs_count: s.docs_received || 0,
      transit_count: s.transit_count || 0,
      bytes: s.bytes_received || 0,
      status: s.status,
      error: null,
    };
  }

  private async loadLogEntries<T>(
    logId: string, mapper: (s: T) => HistoryEntry, label: string
  ): Promise<HistoryEntry[]> {
    try {
      const db = this.dbService.get();
      const log = await db.get(logId);
      const sessions: T[] = log.sessions || [];
      return sessions.map(mapper);
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(`P2pHistory: failed to load ${label}`, err);
      }
      return [];
    }
  }

  private async loadHistory() {
    this.loading = true;

    const syncEntries = await this.loadLogEntries<SyncSession>(
      SYNC_LOG_ID, s => this.mapSyncSession(s), 'sync log'
    );
    const relayEntries = await this.loadLogEntries<RelaySession>(
      RELAY_LOG_ID, s => this.mapRelaySession(s), 'relay log'
    );

    const entries = [...syncEntries, ...relayEntries];
    entries.sort((a, b) => b.started_at - a.started_at);

    this.history = entries;
    this.computeStats();
    this.loading = false;
  }

  private computeStats() {
    this.totalSessions = this.history.length;
    this.totalDocsSynced = 0;
    this.totalBytesTransferred = 0;
    this.totalTransitDocs = 0;

    for (const entry of this.history) {
      this.totalDocsSynced += entry.docs_count;
      this.totalBytesTransferred += entry.bytes;
      this.totalTransitDocs += entry.transit_count;
    }
  }

  /**
   * Format bytes for display.
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(1)} ${units[i]}`;
  }

  /**
   * Format duration between two timestamps.
   */
  formatDuration(startMs: number, endMs: number): string {
    if (!startMs || !endMs) {
      return '--';
    }
    const diffSec = Math.round((endMs - startMs) / 1000);
    if (diffSec < 60) {
      return `${diffSec}s`;
    }
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    return `${min}m ${sec}s`;
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'completed': return 'check_circle';
      case 'failed': return 'error';
      case 'interrupted': return 'warning';
      default: return 'help';
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'p2p-success';
      case 'failed': return 'p2p-error';
      case 'interrupted': return 'p2p-warning-icon';
      default: return '';
    }
  }
}
