import { financialDecimal } from '../market-producer/financial-decimal';
import { formatCurrencyCents, formatImbalance, formatVolume } from './market-metric-formatters';

describe('market metric formatters', () => {
  it('formats cents as USD and rounds only for display', () => {
    const vwapCents = financialDecimal('10150.5');
    expect(formatCurrencyCents(financialDecimal('10200'))).toBe('$102.00');
    expect(formatCurrencyCents(financialDecimal('4'))).toBe('$0.04');
    expect(formatCurrencyCents(vwapCents)).toBe('$101.51');
    expect(vwapCents.toFixed()).toBe('10150.5');
    expect(formatCurrencyCents(financialDecimal('123456789'))).toBe('$1,234,567.89');
    expect(formatCurrencyCents(null)).toBe('—');
  });

  it('formats bigint volume without converting through a number', () => {
    expect(formatVolume(0n)).toBe('0');
    expect(formatVolume(9007199254740993n)).toBe('9,007,199,254,740,993');
  });

  it('keeps imbalance within the display precision', () => {
    expect(formatImbalance(financialDecimal('0.2'))).toBe('0.20');
    expect(formatImbalance(financialDecimal('-0.001'))).toBe('0.00');
    expect(formatImbalance(financialDecimal('1'))).toBe('1.00');
    expect(formatImbalance(null)).toBe('—');
  });
});
