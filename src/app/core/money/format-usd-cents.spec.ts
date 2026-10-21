import { financialDecimal } from './financial-decimal';
import { formatUsdCents } from './format-usd-cents';

describe('USD cents formatting', () => {
  it('rounds only for display and preserves the Decimal input', () => {
    const vwapCents = financialDecimal('10150.5');
    expect(formatUsdCents(financialDecimal('10200'))).toBe('$102.00');
    expect(formatUsdCents(financialDecimal('4'))).toBe('$0.04');
    expect(formatUsdCents(vwapCents)).toBe('$101.51');
    expect(vwapCents.toFixed()).toBe('10150.5');
    expect(formatUsdCents(financialDecimal('123456789'))).toBe('$1,234,567.89');
    expect(formatUsdCents(financialDecimal('900719925474099301'))).toBe(
      '$9,007,199,254,740,993.01',
    );
    expect(formatUsdCents(financialDecimal('-0.1'))).toBe('$0.00');
    expect(formatUsdCents(null)).toBe('—');
  });
});
