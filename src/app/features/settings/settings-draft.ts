import {
  PRODUCER_SETTING_CONSTRAINTS,
  validateProducerSettings,
} from '../market-producer/producer-settings';
import type { ProducerSettingName, ProducerSettings } from '../market-producer/producer-settings';

export type SettingsDraft = Readonly<Record<ProducerSettingName, string>>;

export function draftFromSettings(settings: ProducerSettings): SettingsDraft {
  return {
    instrumentCount: String(settings.instrumentCount),
    updatesPerBatch: String(settings.updatesPerBatch),
    batchIntervalMs: String(settings.batchIntervalMs),
  };
}

export function draftFieldError(field: ProducerSettingName, rawValue: string): string | null {
  const value = rawValue.trim();
  if (value.length === 0) return 'Enter a value.';
  if (!/^-?\d+$/.test(value)) return 'Enter a whole number.';

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 'Enter a whole number.';
  const { minimum, maximum } = PRODUCER_SETTING_CONSTRAINTS[field];
  if (parsed < minimum || parsed > maximum) {
    return `Enter a value from ${minimum} to ${maximum}.`;
  }
  return null;
}

export function parseSettingsDraft(draft: SettingsDraft): ProducerSettings | null {
  if (
    draftFieldError('instrumentCount', draft.instrumentCount) !== null ||
    draftFieldError('updatesPerBatch', draft.updatesPerBatch) !== null ||
    draftFieldError('batchIntervalMs', draft.batchIntervalMs) !== null
  ) {
    return null;
  }

  const settings = {
    instrumentCount: Number(draft.instrumentCount.trim()),
    updatesPerBatch: Number(draft.updatesPerBatch.trim()),
    batchIntervalMs: Number(draft.batchIntervalMs.trim()),
  };
  return validateProducerSettings(settings).length === 0 ? settings : null;
}
