import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { DashboardService } from './dashboard.service';
import { InstrumentTable } from './instrument-table/instrument-table';

@Component({
  selector: 'app-dashboard',
  imports: [TuiButton, InstrumentTable],
  providers: [DashboardService],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly dashboard = inject(DashboardService);
}
