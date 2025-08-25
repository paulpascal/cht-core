import { Component, EventEmitter, OnDestroy, OnInit, Output, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';
import { Store } from '@ngrx/store';

import { GlobalActions } from '@mm-actions/global';
import { Selectors } from '@mm-selectors/index';
import { ReportingPeriod } from '@mm-modules/analytics/analytics-target-aggregates-sidebar-filter.component';
import { NgClass, NgIf, NgFor } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatAccordion } from '@angular/material/expansion';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'mm-analytics-targets-sidebar-filter',
  templateUrl: './analytics-targets-sidebar-filter.component.html',
  standalone: true,
  imports: [NgClass, MatIcon, MatAccordion, NgIf, NgFor, FormsModule, TranslatePipe]
})
export class AnalyticsTargetsSidebarFilterComponent implements OnInit, OnDestroy, OnChanges {
  @Input() selectedPeriod?: ReportingPeriod;
  @Output() reportingPeriodSelectionChanged = new EventEmitter<ReportingPeriod>();
  
  private globalActions: GlobalActions;
  readonly reportingPeriods = [
    { value: ReportingPeriod.CURRENT, label: 'analytics.targets.current_month' },
    { value: ReportingPeriod.PREVIOUS, label: 'analytics.targets.previous_month' }
  ];

  subscriptions: Subscription = new Subscription();
  isOpen = false;
  selectedReportingPeriod: ReportingPeriod = ReportingPeriod.CURRENT;

  constructor(private store: Store) {
    this.globalActions = new GlobalActions(store);
  }

  ngOnInit(): void {
    this.subscribeToStore();
    // Initialize with parent's selected period if provided
    if (this.selectedPeriod) {
      this.selectedReportingPeriod = this.selectedPeriod;
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.selectedPeriod && changes.selectedPeriod.currentValue) {
      this.selectedReportingPeriod = changes.selectedPeriod.currentValue;
    }
  }

  private subscribeToStore() {
    const subscription = this.store
      .select(Selectors.getSidebarFilter)
      .subscribe((filterState) => {
        this.isOpen = filterState?.isOpen ?? false;
        
        // Initialize selected period if not set
        if (!this.selectedReportingPeriod && filterState?.defaultFilters?.reportingPeriod) {
          this.selectedReportingPeriod = filterState.defaultFilters.reportingPeriod;
        }
      });

    this.subscriptions.add(subscription);
  }

  toggleSidebarFilter(): void {
    this.isOpen = !this.isOpen;
    this.globalActions.setSidebarFilter({ isOpen: this.isOpen });
  }

  applyFilter(): void {
    this.reportingPeriodSelectionChanged.emit(this.selectedReportingPeriod);
    this.toggleSidebarFilter();
  }
  
  fetchTargetsByReportingPeriod(): void {
    this.reportingPeriodSelectionChanged.emit(this.selectedReportingPeriod);
  }
}
