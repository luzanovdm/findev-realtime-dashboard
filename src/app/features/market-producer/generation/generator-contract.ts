import { isIntegerInRange } from '../../../core/validation/integer-range';
import { PRODUCER_SETTING_CONSTRAINTS } from '../producer-settings';

const SEED_RANGE = { minimum: 1, maximum: 0xffff_ffff } as const;

export function isGeneratorSeed(value: unknown): value is number {
  return isIntegerInRange(value, SEED_RANGE);
}

export function isGeneratorInstrumentCount(value: unknown): value is number {
  return isIntegerInRange(value, PRODUCER_SETTING_CONSTRAINTS.instrumentCount);
}

export function isGeneratorBatchSize(value: unknown): value is number {
  return isIntegerInRange(value, PRODUCER_SETTING_CONSTRAINTS.updatesPerBatch);
}
