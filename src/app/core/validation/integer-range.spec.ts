import { isIntegerInRange, isNonNegativeSafeInteger, isPositiveSafeInteger } from './integer-range';

describe('safe integer boundaries', () => {
  it('accepts inclusive bounds and rejects fractions and unsafe numbers', () => {
    const range = { minimum: 1, maximum: 50 };
    expect(isIntegerInRange(1, range)).toBe(true);
    expect(isIntegerInRange(50, range)).toBe(true);
    expect(isIntegerInRange(0, range)).toBe(false);
    expect(isIntegerInRange(50.5, range)).toBe(false);
    expect(isIntegerInRange(Number.MAX_SAFE_INTEGER + 1, range)).toBe(false);
    expect(isIntegerInRange('5', range)).toBe(false);
  });

  it('distinguishes positive IDs from nonnegative timestamps', () => {
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(1)).toBe(true);
    expect(isNonNegativeSafeInteger(0)).toBe(true);
    expect(isNonNegativeSafeInteger(-1)).toBe(false);
  });
});
