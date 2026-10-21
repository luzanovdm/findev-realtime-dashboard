import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TuiIcon } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';

@Component({
  selector: 'app-settings',
  imports: [TuiBadge, TuiIcon],
  template: `
    <h1>Settings</h1>
    <p class="page-description">Data producer settings</p>
    <section class="placeholder" aria-labelledby="settings-placeholder">
      <tui-icon icon="@tui.sliders-horizontal" />
      <h2 id="settings-placeholder">Producer settings form</h2>
      <span tuiBadge appearance="neutral">Not implemented</span>
      <p>TODO: Add fields, validation, and setting application.</p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {}
