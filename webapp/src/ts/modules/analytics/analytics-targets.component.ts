import { Component, OnInit, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { RulesEngineService } from '@mm-services/rules-engine.service';
import { PerformanceService } from '@mm-services/performance.service';
import { Selectors } from '@mm-selectors/index';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { ErrorLogComponent } from '@mm-components/error-log/error-log.component';
import { ReportingPeriod } from '@mm-modules/analytics/analytics-target-aggregates-sidebar-filter.component';
import {
  AnalyticsTargetsProgressComponent
} from '@mm-components/analytics-targets-progress/analytics-targets-progress.component';
import { AnalyticsTargetsSidebarFilterComponent } from 
  '@mm-modules/analytics/analytics-targets-sidebar-filter.component';
import { TranslatePipe } from '@ngx-translate/core';
import { ResourceIconPipe } from '@mm-pipes/resource-icon.pipe';
import { TranslateFromPipe } from '@mm-pipes/translate-from.pipe';
import { LocalizeNumberPipe } from '@mm-pipes/number.pipe';

@Component({
  templateUrl: './analytics-targets.component.html',
  imports: [
    NgIf,
    ErrorLogComponent,
    NgFor,
    NgClass,
    AnalyticsTargetsProgressComponent,
    AnalyticsTargetsSidebarFilterComponent,
    TranslatePipe,
    ResourceIconPipe,
    TranslateFromPipe,
    LocalizeNumberPipe,
    FormsModule
  ]
})
export class AnalyticsTargetsComponent implements OnInit, OnDestroy {
  targets: any[] = [];
  loading = true;
  targetsDisabled = false;
  errorStack;
  trackPerformance;
  direction;

  selectedReportingPeriod: ReportingPeriod = ReportingPeriod.CURRENT;
  ReportingPeriod = ReportingPeriod;
  periodSwitching = false;
  sidebarFilterOpen = false;
  
  private subscriptions: Subscription = new Subscription();

  constructor(
    private rulesEngineService: RulesEngineService,
    private performanceService: PerformanceService,
    private store: Store,
  ) {
    this.trackPerformance = this.performanceService.track();
    
    const directionSubscription = this.store.select(Selectors.getDirection).subscribe(direction => {
      this.direction = direction;
    });
    this.subscriptions.add(directionSubscription);
    
    const sidebarSubscription = this.store.select(Selectors.getSidebarFilter).subscribe(filterState => {
      this.sidebarFilterOpen = filterState?.isOpen ?? false;
    });
    this.subscriptions.add(sidebarSubscription);
  }

  ngOnInit(): void {
    this.getTargets();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  toggleSidebar(): void {
    this.sidebarFilterOpen = !this.sidebarFilterOpen;
  }

  onReportingPeriodChanged(reportingPeriod: ReportingPeriod): void {
    this.onPeriodChange(reportingPeriod);
  }

  onPeriodChange(newPeriod: ReportingPeriod): void {
    if (this.selectedReportingPeriod === newPeriod) {
      return;
    }

    this.selectedReportingPeriod = newPeriod;
    this.periodSwitching = true;

    this.getTargets();
  }

  private getTargets() {
    this.loading = true;
    this.errorStack = null;

    return this.rulesEngineService
      .isEnabled()
      .then(isEnabled => {
        this.targetsDisabled = !isEnabled;
        if (!isEnabled) {
          return [];
        }
        return this.rulesEngineService.fetchTargets(this.selectedReportingPeriod);
      })
      .catch(err => {
        console.error('Error getting targets', err);
        this.errorStack = err.stack;
        return [];
      })
      .then((targets: any[] = []) => {
        this.loading = false;
        this.periodSwitching = false;
        this.targets = targets.filter(target => target.visible !== false);
        
        this.trackPerformance?.stop({
          name: ['analytics', 'targets', 'load'].join(':'),
          recordApdex: true,
        });
      });
  }
}
