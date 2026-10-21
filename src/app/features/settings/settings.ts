import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormField, FormRoot } from '@angular/forms/signals';
import { TuiButton } from '@taiga-ui/core';
import { SettingsFormService } from './settings-form.service';

@Component({
  selector: 'app-settings',
  imports: [FormField, FormRoot, TuiButton],
  providers: [SettingsFormService],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  readonly form = inject(SettingsFormService);
}
