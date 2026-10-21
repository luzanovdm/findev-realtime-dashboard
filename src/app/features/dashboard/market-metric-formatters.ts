import type Decimal from 'decimal.js';

const UNAVAILABLE = '—';

export function formatCurrencyCents(cents: Decimal | null): string {
  if (cents === null) return UNAVAILABLE;

  const rounded = cents.dividedBy(100).toDecimalPlaces(2);
  const amount = rounded.abs().toFixed(2);
  const [whole, fractional] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded.isNegative() && !rounded.isZero() ? '-' : ''}$${grouped}.${fractional}`;
}

export function formatVolume(volume: bigint): string {
  return volume.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatImbalance(imbalance: Decimal | null): string {
  if (imbalance === null) return UNAVAILABLE;
  const rounded = imbalance.toDecimalPlaces(2);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}
