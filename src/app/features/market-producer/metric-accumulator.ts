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

export interface MetricState {
  readonly instrumentCount: number;
  readonly instruments: readonly InstrumentState[];
}

export function createMetricState(instrumentCount: number): MetricState {
  if (!Number.isInteger(instrumentCount) || instrumentCount < 1 || instrumentCount > 50) {
    throw new RangeError('Instrument count must be an integer from 1 to 50');
  }
  return { instrumentCount, instruments: Array.from({ length: instrumentCount }, emptyState) };
}

export function accumulateMetricBatch(
  state: MetricState,
  updates: readonly MarketUpdate[],
): MetricState {
  if (!Array.isArray(updates)) throw new ProducerFault('invalid-update');

  const instruments = [...state.instruments];
  try {
    for (const update of updates) {
      assertValidUpdate(update, state.instrumentCount);
      const current = instruments[update.instrumentIndex];
      instruments[update.instrumentIndex] = {
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

  return { ...state, instruments };
}

export function metricSnapshot(state: MetricState): readonly InstrumentMetricSnapshot[] {
  try {
    return state.instruments.map((instrument, index) => {
      const bookQuantity = instrument.bidQuantity + instrument.askQuantity;
      return {
        instrument: instrumentSymbol(index),
        lastPriceCents: instrument.lastPriceCents,
        spreadCents:
          instrument.bidCents === null || instrument.askCents === null
            ? null
            : instrument.askCents.minus(instrument.bidCents),
        volume: instrument.volume,
        vwapCents:
          instrument.volume === 0n
            ? null
            : instrument.notionalCents.dividedBy(instrument.volume.toString()),
        imbalance:
          bookQuantity === 0n
            ? null
            : financialDecimal(instrument.bidQuantity.toString())
                .minus(instrument.askQuantity.toString())
                .dividedBy(bookQuantity.toString()),
      };
    });
  } catch (error: unknown) {
    throw new ProducerFault('metric-failure', error);
  }
}

export function serializedMetricSnapshot(
  state: MetricState,
): readonly SerializedInstrumentMetricSnapshot[] {
  return metricSnapshot(state).map((metric) => ({
    instrument: metric.instrument,
    lastPriceCents: metric.lastPriceCents === null ? null : toDecimalString(metric.lastPriceCents),
    spreadCents: metric.spreadCents === null ? null : toDecimalString(metric.spreadCents),
    volume: metric.volume,
    vwapCents: metric.vwapCents === null ? null : toDecimalString(metric.vwapCents),
    imbalance: metric.imbalance === null ? null : toDecimalString(metric.imbalance),
  }));
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
    throw new ProducerFault('invalid-update', {
      expected: `a valid update for one of ${instrumentCount} instruments`,
      observed: value,
    });
  }
}
