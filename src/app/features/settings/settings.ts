import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';
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

const SAVE_FEEDBACK = {
  saved: {
    success: 'Saved in this browser. New run live.',
    failedRun: 'Your settings were saved in this browser.',
  },
  unavailable: {
    success: 'New run live. Browser storage is unavailable; settings will reset after reload.',
    failedRun: 'Browser storage is unavailable, so the settings will reset after a reload.',
  },
} as const satisfies Readonly<
  Record<'saved' | 'unavailable', { success: string; failedRun: string }>
>;

@Component({
  selector: 'app-settings',
  imports: [FormField, FormRoot, TuiButton],
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
      return sameSettingsDraft(previous.value, draftFromSettings(previous.source))
        ? accepted
        : previous.value;
    },
  });
  readonly settingsForm = form(
    this.draft,
    (path) => {
      for (const field of PRODUCER_SETTING_NAMES) {
        validate(path[field], ({ value }) => {
          const message = draftFieldError(field, value());
          return message === null ? undefined : { kind: 'invalid-setting', message };
        });
      }
    },
    { submission: { action: async () => this.applySettings() } },
  );
  readonly visibleFormError = computed(
    () =>
      this.settingsForm()
        .errors()
        .find((error) => error.kind === 'apply-error')?.message,
  );
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

  private async applySettings(): Promise<{ kind: 'apply-error'; message: string } | undefined> {
    this.feedback.set(null);
    const settings = parseSettingsDraft(this.draft());
    if (settings === null) {
      return { kind: 'apply-error', message: 'Settings could not be applied. Check the fields.' };
    }
    const submittedDraft = draftFromSettings(settings);
    if (!this.producer.apply(settings)) {
      return {
        kind: 'apply-error',
        message: 'Settings could not be applied. Try again when the producer is ready.',
      };
    }

    try {
      const outcome = await firstValueFrom(this.producer.outcomeOf(this.producer.runId()));
      if (this.destroyRef.destroyed) return;
      const saveStatus = this.producer.settingsSaveStatus() ?? 'unavailable';
      const copy = SAVE_FEEDBACK[saveStatus];
      if (outcome === 'error') {
        return {
          kind: 'apply-error',
          message: `The new run could not start. Review the producer error above. ${copy.failedRun}`,
        };
      }

      this.feedback.set({
        draft: submittedDraft,
        kind: saveStatus,
        message: copy.success,
      });
      if (sameSettingsDraft(this.draft(), submittedDraft)) {
        this.settingsForm().reset(draftFromSettings(this.producer.activeSettings()));
      }
    } catch {
      if (!this.destroyRef.destroyed) {
        return { kind: 'apply-error', message: 'Settings could not be applied. Try again.' };
      }
    }
    return undefined;
  }
}
