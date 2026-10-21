import {
  PRODUCER_SETTING_CONSTRAINTS,
  PRODUCER_SETTING_NAMES,
  isProducerSettings,
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

export function sameSettingsDraft(first: SettingsDraft, second: SettingsDraft): boolean {
  return PRODUCER_SETTING_NAMES.every((field) => first[field] === second[field]);
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
  if (PRODUCER_SETTING_NAMES.some((field) => draftFieldError(field, draft[field]) !== null)) {
    return null;
  }
  const settings: unknown = Object.fromEntries(
    PRODUCER_SETTING_NAMES.map((field) => [field, Number(draft[field].trim())]),
  );
  return isProducerSettings(settings) ? settings : null;
}
