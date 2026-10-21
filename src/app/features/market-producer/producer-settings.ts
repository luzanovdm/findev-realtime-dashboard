export interface ProducerSettings {
  readonly instrumentCount: number;
  readonly updatesPerBatch: number;
  readonly batchIntervalMs: number;
}

export type ProducerSettingName = keyof ProducerSettings;

export interface ProducerSettingConstraint {
  readonly minimum: number;
  readonly maximum: number;
  readonly defaultValue: number;
}

export const PRODUCER_SETTING_CONSTRAINTS = {
  instrumentCount: { minimum: 1, maximum: 50, defaultValue: 5 },
  updatesPerBatch: { minimum: 1, maximum: 1_000, defaultValue: 100 },
  batchIntervalMs: { minimum: 50, maximum: 2_000, defaultValue: 500 },
} as const satisfies Readonly<Record<ProducerSettingName, ProducerSettingConstraint>>;

export const DEFAULT_PRODUCER_SETTINGS: Readonly<ProducerSettings> = Object.freeze({
  instrumentCount: PRODUCER_SETTING_CONSTRAINTS.instrumentCount.defaultValue,
  updatesPerBatch: PRODUCER_SETTING_CONSTRAINTS.updatesPerBatch.defaultValue,
  batchIntervalMs: PRODUCER_SETTING_CONSTRAINTS.batchIntervalMs.defaultValue,
});

export type ProducerSettingIssueCode = 'not-number' | 'not-finite' | 'not-integer' | 'out-of-range';

export interface ProducerSettingIssue {
  readonly field: ProducerSettingName;
  readonly code: ProducerSettingIssueCode;
  readonly minimum: number;
  readonly maximum: number;
}

const SETTING_NAMES = [
  'instrumentCount',
  'updatesPerBatch',
  'batchIntervalMs',
] as const satisfies readonly ProducerSettingName[];

export function validateProducerSettings(value: unknown): readonly ProducerSettingIssue[] {
  const candidate = isRecord(value) ? value : {};

  return SETTING_NAMES.flatMap((field): readonly ProducerSettingIssue[] => {
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

function validateSettingValue(
  value: unknown,
  constraint: ProducerSettingConstraint,
): ProducerSettingIssueCode | null {
  if (typeof value !== 'number') return 'not-number';
  if (!Number.isFinite(value)) return 'not-finite';
  if (!Number.isInteger(value)) return 'not-integer';
  if (value < constraint.minimum || value > constraint.maximum) return 'out-of-range';

  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
