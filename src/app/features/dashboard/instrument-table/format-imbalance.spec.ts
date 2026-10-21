import { financialDecimal } from '../../../core/money/financial-decimal';
import { formatImbalance } from './format-imbalance';

describe('imbalance formatting', () => {
  it('uses English fixed decimals only for display', () => {
    expect(formatImbalance(financialDecimal('0.2'))).toBe('0.20');
    expect(formatImbalance(financialDecimal('-0.001'))).toBe('0.00');
    expect(formatImbalance(financialDecimal('1'))).toBe('1.00');
    expect(formatImbalance(null)).toBe('—');
  });
});
