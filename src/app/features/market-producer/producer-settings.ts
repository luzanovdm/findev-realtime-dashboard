import { isRecord } from '../../core/validation/is-record';

export interface ProducerSettingConstraint {
  readonly minimum: number;
  readonly maximum: number;
  readonly defaultValue: number;
}

export const PRODUCER_SETTING_CONSTRAINTS = {
  instrumentCount: { minimum: 1, maximum: 50, defaultValue: 5 },
  updatesPerBatch: { minimum: 1, maximum: 1_000, defaultValue: 100 },
  batchIntervalMs: { minimum: 50, maximum: 2_000, defaultValue: 500 },
} as const satisfies Readonly<Record<string, ProducerSettingConstraint>>;

export type ProducerSettingName = keyof typeof PRODUCER_SETTING_CONSTRAINTS;
export type ProducerSettings = Readonly<Record<ProducerSettingName, number>>;

function isProducerSettingName(name: string): name is ProducerSettingName {
  return Object.hasOwn(PRODUCER_SETTING_CONSTRAINTS, name);
}

export const PRODUCER_SETTING_NAMES: readonly ProducerSettingName[] = Object.keys(
  PRODUCER_SETTING_CONSTRAINTS,
).filter(isProducerSettingName);

export const DEFAULT_PRODUCER_SETTINGS: Readonly<ProducerSettings> = Object.freeze({
  instrumentCount: PRODUCER_SETTING_CONSTRAINTS.instrumentCount.defaultValue,
  updatesPerBatch: PRODUCER_SETTING_CONSTRAINTS.updatesPerBatch.defaultValue,
  batchIntervalMs: PRODUCER_SETTING_CONSTRAINTS.batchIntervalMs.defaultValue,
});

export enum ProducerSettingIssueCode {
  NotNumber = 'not-number',
  NotFinite = 'not-finite',
  NotInteger = 'not-integer',
  OutOfRange = 'out-of-range',
}

export interface ProducerSettingIssue {
  readonly field: ProducerSettingName;
  readonly code: ProducerSettingIssueCode;
  readonly minimum: number;
  readonly maximum: number;
}

export function validateProducerSettings(value: unknown): readonly ProducerSettingIssue[] {
  const candidate = isRecord(value) ? value : {};

  return PRODUCER_SETTING_NAMES.flatMap((field): readonly ProducerSettingIssue[] => {
    const fieldValue = candidate[field];
    const constraint = PRODUCER_SETTING_CONSTRAINTS[field];
    const issue = validateSettingValue(fieldValue, constraint);

    return issue === null
      ? []
      : [
          {
            field,
            code: issue,
            minimum: constraint.minimum,
            maximum: constraint.maximum,
          },
        ];
  });
}

export function isProducerSettings(value: unknown): value is ProducerSettings {
  return validateProducerSettings(value).length === 0;
}

export function copyProducerSettings(settings: ProducerSettings): ProducerSettings {
  return {
    instrumentCount: settings.instrumentCount,
    updatesPerBatch: settings.updatesPerBatch,
    batchIntervalMs: settings.batchIntervalMs,
  };
}

export function sameProducerSettings(first: ProducerSettings, second: ProducerSettings): boolean {
  return PRODUCER_SETTING_NAMES.every((field) => first[field] === second[field]);
}

function validateSettingValue(
  value: unknown,
  constraint: ProducerSettingConstraint,
): ProducerSettingIssueCode | null {
  if (typeof value !== 'number') return ProducerSettingIssueCode.NotNumber;
  if (!Number.isFinite(value)) return ProducerSettingIssueCode.NotFinite;
  if (!Number.isInteger(value)) return ProducerSettingIssueCode.NotInteger;
  if (value < constraint.minimum || value > constraint.maximum)
    return ProducerSettingIssueCode.OutOfRange;

  return null;
}
