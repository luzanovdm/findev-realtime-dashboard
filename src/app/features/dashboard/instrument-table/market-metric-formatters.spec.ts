import { financialDecimal } from '../../../core/money/financial-decimal';
import { formatImbalance, formatVolume } from './market-metric-formatters';

describe('market metric formatters', () => {
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
