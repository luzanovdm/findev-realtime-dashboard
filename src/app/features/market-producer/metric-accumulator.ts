import type Decimal from 'decimal.js';
import { FinancialDecimal, financialDecimal, toDecimalString } from './financial-decimal';
import type {
  InstrumentMetricSnapshot,
  MarketUpdate,
  SerializedInstrumentMetricSnapshot,
} from './market-producer.types';
import { instrumentSymbol } from './market-producer.types';
import { ProducerFault } from './producer-error';

interface InstrumentState {
  readonly lastPriceCents: Decimal | null;
  readonly bidCents: Decimal | null;
  readonly askCents: Decimal | null;
  readonly bidQuantity: bigint;
  readonly askQuantity: bigint;
  readonly volume: bigint;
  readonly notionalCents: Decimal;
}

function emptyState(): InstrumentState {
  return {
    lastPriceCents: null,
    bidCents: null,
    askCents: null,
    bidQuantity: 0n,
    askQuantity: 0n,
    volume: 0n,
    notionalCents: financialDecimal(0),
  };
}

export class MetricAccumulator {
  private states: readonly InstrumentState[];

  constructor(readonly instrumentCount: number) {
    if (!Number.isInteger(instrumentCount) || instrumentCount < 1 || instrumentCount > 50) {
      throw new RangeError('Instrument count must be an integer from 1 to 50');
    }
    this.states = Array.from({ length: instrumentCount }, emptyState);
  }

  applyBatch(updates: readonly MarketUpdate[]): void {
    if (!Array.isArray(updates)) throw new ProducerFault('invalid-update');

    const next = [...this.states];
    try {
      for (const update of updates) {
        assertValidUpdate(update, this.instrumentCount);
        const current = next[update.instrumentIndex];
        next[update.instrumentIndex] = {
          lastPriceCents: update.priceCents,
          bidCents: update.bidCents,
          askCents: update.askCents,
          bidQuantity: update.bidQuantity,
          askQuantity: update.askQuantity,
          volume: current.volume + update.tradeQuantity,
          notionalCents: current.notionalCents.plus(
            update.priceCents.times(update.tradeQuantity.toString()),
          ),
        };
      }
    } catch (error: unknown) {
      if (error instanceof ProducerFault) throw error;
      throw new ProducerFault('metric-failure', error);
    }

    this.states = next;
  }

  snapshot(): readonly InstrumentMetricSnapshot[] {
    try {
      return this.states.map((state, index) => {
        const bookQuantity = state.bidQuantity + state.askQuantity;
        return {
          instrument: instrumentSymbol(index),
          lastPriceCents: state.lastPriceCents,
          spreadCents:
            state.bidCents === null || state.askCents === null
              ? null
              : state.askCents.minus(state.bidCents),
          volume: state.volume,
          vwapCents:
            state.volume === 0n ? null : state.notionalCents.dividedBy(state.volume.toString()),
          imbalance:
            bookQuantity === 0n
              ? null
              : financialDecimal(state.bidQuantity.toString())
                  .minus(state.askQuantity.toString())
                  .dividedBy(bookQuantity.toString()),
        };
      });
    } catch (error: unknown) {
      throw new ProducerFault('metric-failure', error);
    }
  }

  serializedSnapshot(): readonly SerializedInstrumentMetricSnapshot[] {
    return this.snapshot().map((metric) => ({
      instrument: metric.instrument,
      lastPriceCents:
        metric.lastPriceCents === null ? null : toDecimalString(metric.lastPriceCents),
      spreadCents: metric.spreadCents === null ? null : toDecimalString(metric.spreadCents),
      volume: metric.volume,
      vwapCents: metric.vwapCents === null ? null : toDecimalString(metric.vwapCents),
      imbalance: metric.imbalance === null ? null : toDecimalString(metric.imbalance),
    }));
  }
}

function assertValidUpdate(value: unknown, instrumentCount: number): asserts value is MarketUpdate {
  if (typeof value !== 'object' || value === null) throw new ProducerFault('invalid-update');
  const update = value as Partial<MarketUpdate>;
  if (
    !Number.isInteger(update.instrumentIndex) ||
    update.instrumentIndex! < 0 ||
    update.instrumentIndex! >= instrumentCount ||
    !(update.priceCents instanceof FinancialDecimal) ||
    !(update.bidCents instanceof FinancialDecimal) ||
    !(update.askCents instanceof FinancialDecimal) ||
    !update.priceCents.isInteger() ||
    !update.bidCents.isInteger() ||
    !update.askCents.isInteger() ||
    !update.bidCents.greaterThan(0) ||
    !update.askCents.greaterThan(update.bidCents) ||
    (!update.priceCents.equals(update.bidCents) && !update.priceCents.equals(update.askCents)) ||
    typeof update.tradeQuantity !== 'bigint' ||
    update.tradeQuantity <= 0n ||
    typeof update.bidQuantity !== 'bigint' ||
    update.bidQuantity < 0n ||
    typeof update.askQuantity !== 'bigint' ||
    update.askQuantity < 0n
  ) {
    throw new ProducerFault('invalid-update');
  }
}
