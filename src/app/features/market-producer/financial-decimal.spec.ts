import { financialDecimal, isDecimalString, toDecimalString } from './financial-decimal';

describe('financial decimal', () => {
  it('calculates decimal fractions without binary floating-point drift', () => {
    const result = financialDecimal('0.1').plus(financialDecimal('0.2'));

    expect(result.toFixed()).toBe('0.3');
  });

  it('keeps monetary products and ratios in decimal arithmetic', () => {
    const notional = financialDecimal('10000')
      .times('10')
      .plus(financialDecimal('10200').times('30'));
    const vwapCents = notional.dividedBy('40');

    expect(vwapCents.toFixed()).toBe('10150');
  });

  it.each([
    ['0', true],
    ['-1', true],
    ['10150.25', true],
    ['1.230', false],
    ['01', false],
    ['1e3', false],
    ['NaN', false],
    [Number.NaN, false],
  ] as const)('validates canonical decimal string %s', (value, expected) => {
    expect(isDecimalString(value)).toBe(expected);
  });

  it('normalizes values to a canonical non-exponential string', () => {
    expect(toDecimalString('-0')).toBe('0');
    expect(toDecimalString('1000.5000')).toBe('1000.5');
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('rejects a non-finite value: %s', (value) => {
    expect(() => financialDecimal(value)).toThrow(RangeError);
  });
});
