import {
  copyProducerSettings,
  DEFAULT_PRODUCER_SETTINGS,
  isProducerSettings,
  PRODUCER_SETTING_CONSTRAINTS,
  validateProducerSettings,
} from './producer-settings';
import type { ProducerSettings } from './producer-settings';

describe('producer settings', () => {
  it('defines the required defaults', () => {
    expect(DEFAULT_PRODUCER_SETTINGS).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
  });

  it.each([
    {
      instrumentCount: PRODUCER_SETTING_CONSTRAINTS.instrumentCount.minimum,
      updatesPerBatch: PRODUCER_SETTING_CONSTRAINTS.updatesPerBatch.minimum,
      batchIntervalMs: PRODUCER_SETTING_CONSTRAINTS.batchIntervalMs.minimum,
    },
    {
      instrumentCount: PRODUCER_SETTING_CONSTRAINTS.instrumentCount.maximum,
      updatesPerBatch: PRODUCER_SETTING_CONSTRAINTS.updatesPerBatch.maximum,
      batchIntervalMs: PRODUCER_SETTING_CONSTRAINTS.batchIntervalMs.maximum,
    },
  ])('accepts inclusive range boundaries: %o', (settings) => {
    expect(validateProducerSettings(settings)).toEqual([]);
    expect(isProducerSettings(settings)).toBe(true);
  });

  it.each([
    ['instrumentCount', 0, 'out-of-range'],
    ['instrumentCount', 51, 'out-of-range'],
    ['updatesPerBatch', 0, 'out-of-range'],
    ['updatesPerBatch', 1_001, 'out-of-range'],
    ['batchIntervalMs', 49, 'out-of-range'],
    ['batchIntervalMs', 2_001, 'out-of-range'],
    ['instrumentCount', 1.5, 'not-integer'],
    ['updatesPerBatch', Number.NaN, 'not-finite'],
    ['batchIntervalMs', Number.POSITIVE_INFINITY, 'not-finite'],
    ['instrumentCount', '5', 'not-number'],
  ] as const)('rejects %s=%s', (field, value, code) => {
    const settings: Record<string, unknown> = { ...DEFAULT_PRODUCER_SETTINGS, [field]: value };

    expect(validateProducerSettings(settings)).toContainEqual({
      field,
      code,
      minimum: PRODUCER_SETTING_CONSTRAINTS[field].minimum,
      maximum: PRODUCER_SETTING_CONSTRAINTS[field].maximum,
    });
    expect(isProducerSettings(settings)).toBe(false);
  });

  it('reports all missing fields for a non-object value', () => {
    expect(validateProducerSettings(null).map(({ field }) => field)).toEqual([
      'instrumentCount',
      'updatesPerBatch',
      'batchIntervalMs',
    ]);
  });

  it('copies settings without sharing the source object', () => {
    const source: ProducerSettings = { ...DEFAULT_PRODUCER_SETTINGS };
    const copy = copyProducerSettings(source);

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });
});
