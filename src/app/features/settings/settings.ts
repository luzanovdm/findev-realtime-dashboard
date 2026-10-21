import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormField, form, submit, validate } from '@angular/forms/signals';
import { TuiButton } from '@taiga-ui/core';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import { draftFieldError, draftFromSettings, parseSettingsDraft } from './settings-draft';
import type { SettingsDraft } from './settings-draft';

@Component({
  selector: 'app-settings',
  imports: [FormField, TuiButton],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  readonly producer = inject(MarketProducerFacade);
  readonly draft = signal<SettingsDraft>(draftFromSettings(this.producer.activeSettings()));
  readonly settingsForm = form(this.draft, (path) => {
    validate(path.instrumentCount, ({ value }) => {
      const message = draftFieldError('instrumentCount', value());
      return message === null ? undefined : { kind: 'invalid-setting', message };
    });
    validate(path.updatesPerBatch, ({ value }) => {
      const message = draftFieldError('updatesPerBatch', value());
      return message === null ? undefined : { kind: 'invalid-setting', message };
    });
    validate(path.batchIntervalMs, ({ value }) => {
      const message = draftFieldError('batchIntervalMs', value());
      return message === null ? undefined : { kind: 'invalid-setting', message };
    });
  });
  readonly formError = signal<string | null>(null);
  readonly applyUnavailable = computed(
    () =>
      this.producer.status() === 'initializing' || this.producer.error()?.recoveryAction === 'none',
  );
  private readonly awaitingRunId = signal<number | null>(null);

  constructor() {
    effect(() => {
      const active = this.producer.activeSettings();
      const awaitingRunId = this.awaitingRunId();
      if (awaitingRunId !== null) {
        if (this.producer.runId() === awaitingRunId && this.producer.status() === 'running') {
          untracked(() => this.settingsForm().reset(draftFromSettings(active)));
          this.awaitingRunId.set(null);
          this.formError.set(null);
        } else if (this.producer.runId() === awaitingRunId && this.producer.status() === 'error') {
          this.awaitingRunId.set(null);
          this.formError.set('The new run could not start. Review the producer error above.');
        }
        return;
      }
      if (!this.settingsForm().dirty()) {
        untracked(() => this.settingsForm().reset(draftFromSettings(active)));
      }
    });
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.applyUnavailable()) return;
    this.formError.set(null);
    void submit(this.settingsForm, async () => {
      const settings = parseSettingsDraft(this.draft());
      if (settings === null) return;
      if (!this.producer.apply(settings)) {
        this.formError.set('Settings could not be applied. Try again when the producer is ready.');
        return;
      }
      this.awaitingRunId.set(this.producer.runId());
    }).catch(() => {
      this.formError.set('Settings could not be applied. Try again.');
    });
  }
}
