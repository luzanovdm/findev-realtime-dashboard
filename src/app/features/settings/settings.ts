import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormField, form, submit, validate } from '@angular/forms/signals';
import { TuiButton } from '@taiga-ui/core';
import { firstValueFrom } from 'rxjs';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import {
  draftFieldError,
  draftFromSettings,
  parseSettingsDraft,
  sameSettingsDraft,
} from './settings-draft';
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
  private readonly destroyRef = inject(DestroyRef);
  readonly draft = linkedSignal({
    source: this.producer.activeSettings,
    computation: (settings, previous): SettingsDraft => {
      const accepted = draftFromSettings(settings);
      if (!previous) return accepted;
      const pristine = sameSettingsDraft(previous.value, draftFromSettings(previous.source));
      return pristine ? accepted : previous.value;
    },
  });
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
      const outcome = await firstValueFrom(this.producer.outcomeOf(this.producer.runId()));
      if (this.destroyRef.destroyed) return;
      if (outcome === 'error') {
        this.formError.set('The new run could not start. Review the producer error above.');
      }
      if (outcome === 'running' && sameSettingsDraft(this.draft(), draftFromSettings(settings))) {
        this.settingsForm().reset(draftFromSettings(this.producer.activeSettings()));
      }
    }).catch(() => {
      if (!this.destroyRef.destroyed) {
        this.formError.set('Settings could not be applied. Try again.');
      }
    });
  }
}
