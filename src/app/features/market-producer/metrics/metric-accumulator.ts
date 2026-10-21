import type Decimal from 'decimal.js';
import {
  FinancialDecimal,
  financialDecimal,
  toNullableDecimalString,
} from '../../../core/money/financial-decimal';
import { isRecord } from '../../../core/validation/is-record';
import { isIntegerInRange, isNonNegativeSafeInteger } from '../../../core/validation/integer-range';
import type {
  InstrumentMetricSnapshot,
  MarketUpdate,
  SerializedInstrumentMetricSnapshot,
} from '../market-producer.types';
import { instrumentSymbol } from '../market-producer.types';
import { ProducerFault } from '../producer-error';
import { ProducerErrorCode } from '../market-producer.types';
import { PRODUCER_SETTING_CONSTRAINTS } from '../producer-settings';

interface InstrumentState {
  readonly lastPriceCents: Decimal | null;
  readonly bidCents: Decimal | null;
  readonly askCents: Decimal | null;
  readonly bidQuantity: bigint;
  readonly askQuantity: bigint;
  readonly volume: bigint;
  readonly notionalCents: Decimal;
}

type BatchInstrumentState = { -readonly [Key in keyof InstrumentState]: InstrumentState[Key] };

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
  const { minimum, maximum } = PRODUCER_SETTING_CONSTRAINTS.instrumentCount;
  if (!isIntegerInRange(instrumentCount, { minimum, maximum })) {
    throw new RangeError(`Instrument count must be an integer from ${minimum} to ${maximum}`);
  }
  return { instrumentCount, instruments: Array.from({ length: instrumentCount }, emptyState) };
}

export function accumulateMetricBatch(
  state: MetricState,
  updates: readonly MarketUpdate[],
): MetricState {
  if (!Array.isArray(updates)) throw new ProducerFault(ProducerErrorCode.InvalidUpdate);

  const staged: (BatchInstrumentState | undefined)[] = Array(state.instrumentCount);
  try {
    for (const update of updates) {
      assertValidUpdate(update, state.instrumentCount);
      const index = update.instrumentIndex;
      let current = staged[index];
      if (current === undefined) {
        const previous = state.instruments[index];
        if (previous === undefined) throw new ProducerFault(ProducerErrorCode.InvalidUpdate);
        current = { ...previous };
        staged[index] = current;
      }
      current.lastPriceCents = update.priceCents;
      current.bidCents = update.bidCents;
      current.askCents = update.askCents;
      current.bidQuantity = update.bidQuantity;
      current.askQuantity = update.askQuantity;
      current.volume += update.tradeQuantity;
      current.notionalCents = current.notionalCents.plus(
        update.priceCents.times(update.tradeQuantity.toString()),
      );
    }
  } catch (error: unknown) {
    if (error instanceof ProducerFault) throw error;
    throw new ProducerFault(ProducerErrorCode.MetricFailure, error);
  }

  const instruments = [...state.instruments];
  staged.forEach((instrument, index) => {
    if (instrument !== undefined) instruments[index] = instrument;
  });
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
    throw new ProducerFault(ProducerErrorCode.MetricFailure, error);
  }
}

export function serializedMetricSnapshot(
  state: MetricState,
): readonly SerializedInstrumentMetricSnapshot[] {
  return metricSnapshot(state).map((metric) => ({
    instrument: metric.instrument,
    lastPriceCents: toNullableDecimalString(metric.lastPriceCents),
    spreadCents: toNullableDecimalString(metric.spreadCents),
    volume: metric.volume,
    vwapCents: toNullableDecimalString(metric.vwapCents),
    imbalance: toNullableDecimalString(metric.imbalance),
  }));
}

function assertValidUpdate(value: unknown, instrumentCount: number): asserts value is MarketUpdate {
  if (!isRecord(value) || !hasValidFields(value) || !hasValidRelations(value, instrumentCount)) {
    throw new ProducerFault(ProducerErrorCode.InvalidUpdate, {
      expected: `a valid update for one of ${instrumentCount} instruments`,
      observed: value,
    });
  }
}

type ValueGuard = (value: unknown) => boolean;

const UPDATE_FIELDS: readonly (readonly [string, ValueGuard])[] = Object.entries({
  instrumentIndex: isNonNegativeSafeInteger,
  priceCents: isPositiveWholeDecimal,
  tradeQuantity: (value: unknown) => typeof value === 'bigint' && value > 0n,
  bidCents: isPositiveWholeDecimal,
  askCents: isPositiveWholeDecimal,
  bidQuantity: (value: unknown) => typeof value === 'bigint' && value >= 0n,
  askQuantity: (value: unknown) => typeof value === 'bigint' && value >= 0n,
} satisfies Readonly<Record<keyof MarketUpdate, ValueGuard>>);

function isPositiveWholeDecimal(value: unknown): value is Decimal {
  return value instanceof FinancialDecimal && value.isInteger() && value.greaterThan(0);
}

function hasValidFields(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & MarketUpdate {
  for (const [field, guard] of UPDATE_FIELDS) {
    if (!guard(value[field])) return false;
  }
  return true;
}

function hasValidRelations(update: MarketUpdate, instrumentCount: number): boolean {
  return (
    update.instrumentIndex < instrumentCount &&
    update.askCents.greaterThan(update.bidCents) &&
    (update.priceCents.equals(update.bidCents) || update.priceCents.equals(update.askCents))
  );
}
