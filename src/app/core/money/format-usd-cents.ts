import type Decimal from 'decimal.js';
import { groupDigits } from '../numbers/group-digits';

export function formatUsdCents(cents: Decimal | null): string {
  if (cents === null) return '—';

  const rounded = cents.dividedBy(100).toDecimalPlaces(2);
  const amount = rounded.abs().toFixed(2);
  const decimalPoint = amount.indexOf('.');
  const whole = amount.slice(0, decimalPoint);
  const fractional = amount.slice(decimalPoint + 1);
  const grouped = groupDigits(whole);
  return `${rounded.isNegative() && !rounded.isZero() ? '-' : ''}$${grouped}.${fractional}`;
}
