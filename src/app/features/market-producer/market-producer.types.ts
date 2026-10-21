import type Decimal from 'decimal.js';
import type { DecimalString } from './financial-decimal';

export type ProducerStatus = 'initializing' | 'running' | 'paused' | 'error';

export type ProducerErrorCode =
  'worker-unavailable' | 'wasm-fetch' | 'wasm-instantiate' | 'wasm-abi' | 'protocol' | 'generation';

export interface ProducerError {
  readonly code: ProducerErrorCode;
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
  if (!Number.isInteger(instrumentIndex) || instrumentIndex < 0 || instrumentIndex >= 50) {
    throw new RangeError(`Instrument index must be an integer from 0 to 49: ${instrumentIndex}`);
  }

  return `ASSET-${String(instrumentIndex + 1).padStart(2, '0')}`;
}
