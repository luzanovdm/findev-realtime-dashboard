import {
  accumulateMetricBatch,
  createMetricState,
  serializedMetricSnapshot,
} from '../metrics/metric-accumulator';
import type { MetricState } from '../metrics/metric-accumulator';
import { ProducerErrorCode } from '../market-producer.types';
import type { MarketUpdate } from '../market-producer.types';
import { ProducerFault } from '../producer-error';
import type { ProducerWorkerEvent } from './worker.protocol';

export interface RunClock {
  now(): number;
  timestampMs(): number;
}

export interface BatchContext {
  readonly runId: number;
  readonly batchSize: number;
  readonly intervalMs: number;
}

interface PaceState {
  readonly lastBatchAt: number | null;
  readonly lateIntervals: number;
  readonly timelyIntervals: number;
  readonly slow: boolean;
}

export interface ActiveState {
  readonly metrics: MetricState;
  readonly sequence: number;
  readonly publishedSequence: number;
  readonly lastPublishedAt: number | null;
  readonly pace: PaceState;
  readonly events: readonly ProducerWorkerEvent[];
}

const INITIAL_PACE: PaceState = {
  lastBatchAt: null,
  lateIntervals: 0,
  timelyIntervals: 0,
  slow: false,
};

export function createActiveState(instrumentCount: number): ActiveState {
  return {
    metrics: createMetricState(instrumentCount),
    sequence: 0,
    publishedSequence: 0,
    lastPublishedAt: null,
    pace: INITIAL_PACE,
    events: [],
  };
}

export function resumeState(state: ActiveState, runId: number): ActiveState {
  return {
    ...state,
    pace: INITIAL_PACE,
    events: [{ type: 'status-changed', runId, status: 'running' }],
  };
}

export function pauseState(state: ActiveState, runId: number, clock: RunClock): ActiveState {
  const publishPending = state.sequence > state.publishedSequence;
  const events: ProducerWorkerEvent[] = [];
  if (publishPending) events.push(makeSnapshot(state, runId, clock));
  if (state.pace.slow) events.push({ type: 'pace-changed', runId, slow: false });
  events.push({ type: 'status-changed', runId, status: 'paused' });
  return {
    ...state,
    publishedSequence: state.sequence,
    lastPublishedAt: publishPending ? clock.now() : state.lastPublishedAt,
    pace: INITIAL_PACE,
    events,
  };
}

export function reduceBatch(
  state: ActiveState,
  updates: readonly MarketUpdate[],
  context: BatchContext,
  clock: RunClock,
): ActiveState {
  if (updates.length !== context.batchSize) throw new ProducerFault(ProducerErrorCode.Protocol);
  const metrics = accumulateMetricBatch(state.metrics, updates);
  const sequence = state.sequence + 1;
  const now = clock.now();
  const pace = measurePace(state.pace, now, context.intervalMs);
  const publish = state.lastPublishedAt === null || now - state.lastPublishedAt >= 100;
  const next = { ...state, metrics, pace, sequence };
  const events: ProducerWorkerEvent[] = [];
  if (publish) events.push(makeSnapshot(next, context.runId, clock));
  if (pace.slow !== state.pace.slow) {
    events.push({ type: 'pace-changed', runId: context.runId, slow: pace.slow });
  }
  return {
    ...next,
    publishedSequence: publish ? sequence : state.publishedSequence,
    lastPublishedAt: publish ? now : state.lastPublishedAt,
    events,
  };
}

function measurePace(previous: PaceState, now: number, intervalMs: number): PaceState {
  if (previous.lastBatchAt === null) return { ...INITIAL_PACE, lastBatchAt: now };

  const late = now - previous.lastBatchAt > intervalMs * 2;
  const lateIntervals = late ? previous.lateIntervals + 1 : 0;
  const timelyIntervals = late ? 0 : previous.timelyIntervals + 1;
  const slow = lateIntervals >= 5 || (previous.slow && timelyIntervals < 5);

  return { lastBatchAt: now, lateIntervals, timelyIntervals, slow };
}

function makeSnapshot(state: ActiveState, runId: number, clock: RunClock): ProducerWorkerEvent {
  return {
    type: 'snapshot',
    runId,
    sequence: state.sequence,
    timestampMs: clock.timestampMs(),
    metrics: serializedMetricSnapshot(state.metrics),
  };
}
