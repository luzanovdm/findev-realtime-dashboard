import type Decimal from 'decimal.js';
import type { DecimalString } from '../../core/money/financial-decimal';
import { isIntegerInRange } from '../../core/validation/integer-range';
import { PRODUCER_SETTING_CONSTRAINTS } from './producer-settings';

export type ProducerStatus = 'initializing' | 'running' | 'paused' | 'error';

export type ProducerErrorCode =
  | 'worker-unavailable'
  | 'wasm-fetch'
  | 'wasm-instantiate'
  | 'worker-crash'
  | 'worker-timeout'
  | 'generation'
  | 'wasm-abi'
  | 'protocol'
  | 'invalid-update'
  | 'metric-failure';

export type ProducerErrorSeverity = 'environment' | 'run-error' | 'integrity-critical';
export type ProducerDataDisposition = 'hide' | 'stale';
export type ProducerRecoveryAction = 'none' | 'start-new-run';

export interface ProducerError {
  readonly code: ProducerErrorCode;
  readonly severity: ProducerErrorSeverity;
  readonly dataDisposition: ProducerDataDisposition;
  readonly recoveryAction: ProducerRecoveryAction;
  readonly message: string;
}

export interface MarketUpdate {
  readonly instrumentIndex: number;
  readonly priceCents: Decimal;
  readonly tradeQuantity: bigint;
  readonly bidCents: Decimal;
  readonly askCents: Decimal;
  readonly bidQuantity: bigint;
  readonly askQuantity: bigint;
}

export interface InstrumentMetricSnapshot {
  readonly instrument: string;
  readonly lastPriceCents: Decimal | null;
  readonly spreadCents: Decimal | null;
  readonly volume: bigint;
  readonly vwapCents: Decimal | null;
  readonly imbalance: Decimal | null;
}

export interface SerializedInstrumentMetricSnapshot {
  readonly instrument: string;
  readonly lastPriceCents: DecimalString | null;
  readonly spreadCents: DecimalString | null;
  readonly volume: bigint;
  readonly vwapCents: DecimalString | null;
  readonly imbalance: DecimalString | null;
}

export function instrumentSymbol(instrumentIndex: number): string {
  const maximum = PRODUCER_SETTING_CONSTRAINTS.instrumentCount.maximum;
  if (!isIntegerInRange(instrumentIndex, { minimum: 0, maximum: maximum - 1 })) {
    throw new RangeError(
      `Instrument index must be an integer from 0 to ${maximum - 1}: ${instrumentIndex}`,
    );
  }

  return `ASSET-${String(instrumentIndex + 1).padStart(2, '0')}`;
}
