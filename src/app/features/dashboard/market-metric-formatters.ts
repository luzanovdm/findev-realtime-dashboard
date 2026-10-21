import type Decimal from 'decimal.js';

const UNAVAILABLE = '—';

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCurrencyCents(cents: Decimal | null): string {
  if (cents === null) return UNAVAILABLE;

  const rounded = cents.dividedBy(100).toDecimalPlaces(2);
  const amount = rounded.abs().toFixed(2);
  const decimalPoint = amount.indexOf('.');
  const whole = amount.slice(0, decimalPoint);
  const fractional = amount.slice(decimalPoint + 1);
  const grouped = groupDigits(whole);
  return `${rounded.isNegative() && !rounded.isZero() ? '-' : ''}$${grouped}.${fractional}`;
}

export function formatVolume(volume: bigint): string {
  return groupDigits(volume.toString());
}

export function formatImbalance(imbalance: Decimal | null): string {
  if (imbalance === null) return UNAVAILABLE;
  const rounded = imbalance.toDecimalPlaces(2);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}
