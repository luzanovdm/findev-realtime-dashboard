import { computed, DestroyRef, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import {
  MarketProducerFacade,
  RunOutcome,
  SettingsSaveStatus,
} from '../market-producer/market-producer.facade';
import { ProducerRecoveryAction } from '../market-producer/market-producer.types';
import { PRODUCER_SETTING_NAMES } from '../market-producer/producer-settings';
import {
  draftFieldError,
  draftFromSettings,
  parseSettingsDraft,
  sameSettingsDraft,
} from './settings-draft';
import type { SettingsDraft } from './settings-draft';

const SAVE_FEEDBACK = {
  [SettingsSaveStatus.Saved]: {
    success: 'Saved in this browser. New run live.',
    failedRun: 'Your settings were saved in this browser.',
  },
  [SettingsSaveStatus.Unavailable]: {
    success: 'New run live. Browser storage is unavailable; settings will reset after reload.',
    failedRun: 'Browser storage is unavailable, so the settings will reset after a reload.',
  },
} as const satisfies Readonly<Record<SettingsSaveStatus, { success: string; failedRun: string }>>;

const APPLY_FAILURE_MESSAGE = {
  [RunOutcome.Error]: 'The new run could not start. Review the producer error above.',
  [RunOutcome.Replaced]: 'A newer run replaced this submission. Review the current settings.',
  [RunOutcome.Timeout]: 'The new run did not respond in time. Try applying the settings again.',
} as const satisfies Readonly<Record<Exclude<RunOutcome, RunOutcome.Running>, string>>;

@Injectable()
export class SettingsFormService {
  private readonly producer = inject(MarketProducerFacade);
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
  private readonly feedback = signal<{
    readonly runId: number;
    readonly draft: SettingsDraft;
    readonly warning: boolean;
    readonly message: string;
  } | null>(null);
  readonly visibleFeedback = computed(() => {
    const feedback = this.feedback();
    return feedback !== null &&
      feedback.runId === this.producer.runId() &&
      this.producer.status() !== 'error' &&
      sameSettingsDraft(feedback.draft, this.draft())
      ? feedback
      : null;
  });
  readonly applyUnavailable = computed(
    () =>
      this.settingsForm().submitting() ||
      this.producer.status() === 'initializing' ||
      this.producer.error()?.recoveryAction === ProducerRecoveryAction.None,
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

    const runId = this.producer.runId();
    const saveStatus = this.producer.settingsSaveStatus() ?? SettingsSaveStatus.Unavailable;
    const copy = SAVE_FEEDBACK[saveStatus];

    try {
      const outcome = await firstValueFrom(
        this.producer.outcomeOf(runId).pipe(takeUntilDestroyed(this.destroyRef)),
      );
      if (this.destroyRef.destroyed) return;
      if (outcome !== RunOutcome.Running) {
        return {
          kind: 'apply-error',
          message: `${APPLY_FAILURE_MESSAGE[outcome]} ${copy.failedRun}`,
        };
      }

      this.feedback.set({
        runId,
        draft: submittedDraft,
        warning: saveStatus === SettingsSaveStatus.Unavailable,
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
