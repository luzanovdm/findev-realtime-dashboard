import type Decimal from 'decimal.js';

const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsdCents(cents: Decimal | null): string {
  if (cents === null) return '—';

  const rounded = cents.dividedBy(100).toDecimalPlaces(2);
  return USD_FORMAT.format(rounded.isZero() ? '0' : rounded.toFixed(2));
}
