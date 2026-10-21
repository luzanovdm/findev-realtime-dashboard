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
import { PRODUCER_SETTING_NAMES } from '../market-producer/producer-settings';
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
    for (const field of PRODUCER_SETTING_NAMES) {
      validate(path[field], ({ value }) => {
        const message = draftFieldError(field, value());
        return message === null ? undefined : { kind: 'invalid-setting', message };
      });
    }
  });
  readonly formError = signal<{ readonly draft: SettingsDraft; readonly message: string } | null>(
    null,
  );
  readonly visibleFormError = computed(() => {
    const error = this.formError();
    return error !== null && sameSettingsDraft(error.draft, this.draft()) ? error.message : null;
  });
  readonly feedback = signal<{
    readonly draft: SettingsDraft;
    readonly kind: 'saved' | 'unavailable';
    readonly message: string;
  } | null>(null);
  readonly visibleFeedback = computed(() => {
    const feedback = this.feedback();
    return feedback !== null && sameSettingsDraft(feedback.draft, this.draft()) ? feedback : null;
  });
  readonly applyUnavailable = computed(
    () =>
      this.settingsForm().submitting() ||
      this.producer.status() === 'initializing' ||
      this.producer.error()?.recoveryAction === 'none',
  );

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.applyUnavailable()) return;
    this.formError.set(null);
    this.feedback.set(null);
    void submit(this.settingsForm, async () => {
      const settings = parseSettingsDraft(this.draft());
      if (settings === null) return;
      const submittedDraft = draftFromSettings(settings);
      if (!this.producer.apply(settings)) {
        this.formError.set({
          draft: this.draft(),
          message: 'Settings could not be applied. Try again when the producer is ready.',
        });
        return;
      }
      const outcome = await firstValueFrom(this.producer.outcomeOf(this.producer.runId()));
      if (this.destroyRef.destroyed) return;
      if (outcome === 'error') {
        const storageMessage =
          this.producer.settingsSaveStatus() === 'saved'
            ? 'Your settings were saved in this browser.'
            : 'Browser storage is unavailable, so the settings will reset after a reload.';
        this.formError.set({
          draft: this.draft(),
          message: `The new run could not start. Review the producer error above. ${storageMessage}`,
        });
      }
      if (outcome === 'running') {
        const saved = this.producer.settingsSaveStatus() === 'saved';
        this.feedback.set({
          draft: submittedDraft,
          kind: saved ? 'saved' : 'unavailable',
          message: saved
            ? 'Saved in this browser. New run live.'
            : 'New run live. Browser storage is unavailable; settings will reset after reload.',
        });
        if (sameSettingsDraft(this.draft(), submittedDraft)) {
          this.settingsForm().reset(draftFromSettings(this.producer.activeSettings()));
        }
      }
    }).catch(() => {
      if (!this.destroyRef.destroyed) {
        this.formError.set({
          draft: this.draft(),
          message: 'Settings could not be applied. Try again.',
        });
      }
    });
  }
}
