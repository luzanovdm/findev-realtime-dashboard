import type Decimal from 'decimal.js';
import { groupDigits } from '../../../core/numbers/group-digits';

const UNAVAILABLE = '—';

export function formatVolume(volume: bigint): string {
  return groupDigits(volume.toString());
}

export function formatImbalance(imbalance: Decimal | null): string {
  if (imbalance === null) return UNAVAILABLE;
  const rounded = imbalance.toDecimalPlaces(2);
  return rounded.isZero() ? '0.00' : rounded.toFixed(2);
}
