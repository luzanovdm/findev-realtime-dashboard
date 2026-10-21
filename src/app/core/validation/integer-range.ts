export interface IntegerRange {
  readonly minimum: number;
  readonly maximum: number;
}

const POSITIVE_SAFE_INTEGER_RANGE = { minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const NON_NEGATIVE_SAFE_INTEGER_RANGE = { minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;

export function isIntegerInRange(value: unknown, range: IntegerRange): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isSafeInteger(value)) return false;
  return value >= range.minimum && value <= range.maximum;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return isIntegerInRange(value, POSITIVE_SAFE_INTEGER_RANGE);
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return isIntegerInRange(value, NON_NEGATIVE_SAFE_INTEGER_RANGE);
}
