import type Decimal from 'decimal.js';

const IMBALANCE_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function formatImbalance(imbalance: Decimal | null): string {
  if (imbalance === null) return '—';
  const rounded = imbalance.toDecimalPlaces(2);
  return IMBALANCE_FORMAT.format(rounded.isZero() ? '0' : rounded.toFixed(2));
}
