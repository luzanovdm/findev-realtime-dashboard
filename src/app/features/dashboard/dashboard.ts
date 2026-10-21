import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TuiIcon } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';

@Component({
  selector: 'app-dashboard',
  imports: [TuiBadge, TuiIcon],
  template: `
    <h1>Dashboard</h1>
    <p class="page-description">Live market dashboard</p>
    <section class="placeholder" aria-labelledby="dashboard-placeholder">
      <tui-icon icon="@tui.chart-no-axes-combined" />
      <h2 id="dashboard-placeholder">Instrument table</h2>
      <span tuiBadge appearance="neutral">Not implemented</span>
      <p>TODO: Add market updates, metrics, producer controls, and status.</p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {}
