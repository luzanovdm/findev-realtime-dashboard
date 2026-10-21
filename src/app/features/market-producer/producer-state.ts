import { match } from 'ts-pattern';
import { fromNullableDecimalString } from './metrics/financial-decimal';
import { instrumentSymbol } from './market-producer.types';
import type {
  InstrumentMetricSnapshot,
  ProducerDataDisposition,
  ProducerError,
  ProducerErrorCode,
  ProducerStatus,
} from './market-producer.types';
import { describeProducerError } from './producer-error';
import {
  copyProducerSettings,
  DEFAULT_PRODUCER_SETTINGS,
  sameProducerSettings,
} from './producer-settings';
import type { ProducerSettings } from './producer-settings';
import type {
  PaceChangedEvent,
  ProducerWorkerEvent,
  RunStartedEvent,
  SnapshotEvent,
  StatusChangedEvent,
} from './generation/worker.protocol';

const INITIALIZATION_DEADLINE_MS = 5_000;
const COMMAND_DEADLINE_MS = 2_000;

type ProducerControl = 'pause' | 'resume';

export interface ProducerState {
  readonly runId: number;
  readonly status: ProducerStatus;
  readonly activeSettings: ProducerSettings;
  readonly pendingSettings: ProducerSettings;
  readonly metrics: readonly InstrumentMetricSnapshot[];
  readonly error: ProducerError | null;
  readonly stale: boolean;
  readonly slow: boolean;
  readonly snapshotAt: number | null;
  readonly lastSequence: number;
  readonly runAcknowledged: boolean;
  readonly pendingControl: ProducerControl | null;
}

export type ProducerAction =
  | { readonly type: 'begin'; readonly settings: ProducerSettings }
  | { readonly type: 'control'; readonly control: ProducerControl }
  | { readonly type: 'worker-event'; readonly event: ProducerWorkerEvent }
  | { readonly type: 'failure'; readonly code: ProducerErrorCode };

const CONTROL_SOURCE_STATUS = {
  pause: 'running',
  resume: 'paused',
} as const satisfies Readonly<Record<ProducerControl, ProducerStatus>>;

function enterRunning(state: ProducerState): ProducerState {
  return { ...state, status: 'running', pendingControl: null };
}

interface StatusTransition {
  readonly from: ProducerStatus;
  readonly allowed: (state: ProducerState) => boolean;
  readonly enter: (state: ProducerState) => ProducerState;
}

const STATUS_TRANSITIONS = {
  initializing: [{ from: 'initializing', allowed: () => true, enter: (state) => state }],
  running: [
    {
      from: 'initializing',
      allowed: (state) => state.runAcknowledged,
      enter: enterRunning,
    },
    {
      from: 'paused',
      allowed: (state) => state.runAcknowledged && state.pendingControl === 'resume',
      enter: enterRunning,
    },
  ],
  paused: [
    {
      from: 'running',
      allowed: (state) => state.pendingControl === 'pause',
      enter: (state) => ({ ...state, status: 'paused', slow: false, pendingControl: null }),
    },
  ],
  error: [],
} satisfies Readonly<Record<ProducerStatus, readonly StatusTransition[]>>;

type SnapshotRule = (state: ProducerState, event: SnapshotEvent) => boolean;

const SNAPSHOT_RULES = Object.values({
  acknowledged: (state) => state.runAcknowledged,
  running: (state) => state.status === 'running',
  sequenceAdvanced: (state, event) => event.sequence > state.lastSequence,
  expectedRowCount: (state, event) => event.metrics.length === state.activeSettings.instrumentCount,
  orderedSymbolsAndMonotonicVolume: (state, event) =>
    event.metrics.every((metric, index) => {
      const previous = state.metrics[index];
      return (
        previous !== undefined &&
        metric.instrument === instrumentSymbol(index) &&
        metric.volume >= previous.volume
      );
    }),
  tradeOccurred: (state, event) =>
    event.metrics.some((metric, index) => {
      const previous = state.metrics[index];
      return previous !== undefined && metric.volume > previous.volume;
    }),
} satisfies Readonly<Record<string, SnapshotRule>>);

const FAILURE_DATA = {
  hide: (state: ProducerState) => ({
    metrics: emptyMetrics(state.pendingSettings.instrumentCount),
    snapshotAt: null,
    stale: false,
  }),
  stale: (state: ProducerState) => ({
    metrics: state.metrics,
    snapshotAt: state.snapshotAt,
    stale: state.snapshotAt !== null,
  }),
} satisfies Readonly<
  Record<
    ProducerDataDisposition,
    (state: ProducerState) => Pick<ProducerState, 'metrics' | 'snapshotAt' | 'stale'>
  >
>;

function emptyMetrics(instrumentCount: number): readonly InstrumentMetricSnapshot[] {
  return Array.from({ length: instrumentCount }, (_, index) => ({
    instrument: instrumentSymbol(index),
    lastPriceCents: null,
    spreadCents: null,
    volume: 0n,
    vwapCents: null,
    imbalance: null,
  }));
}

export const INITIAL_PRODUCER_STATE: ProducerState = {
  runId: 0,
  status: 'initializing',
  activeSettings: DEFAULT_PRODUCER_SETTINGS,
  pendingSettings: DEFAULT_PRODUCER_SETTINGS,
  metrics: emptyMetrics(DEFAULT_PRODUCER_SETTINGS.instrumentCount),
  error: null,
  stale: false,
  slow: false,
  snapshotAt: null,
  lastSequence: 0,
  runAcknowledged: false,
  pendingControl: null,
};

export function controlDeadline(state: ProducerState): number | null {
  if (state.runId === 0 || state.status === 'error') return null;
  if (state.status === 'initializing') return INITIALIZATION_DEADLINE_MS;
  if (state.pendingControl !== null) return COMMAND_DEADLINE_MS;
  return null;
}

export function reduceProducerState(state: ProducerState, action: ProducerAction): ProducerState {
  if (state.status === 'error' && action.type !== 'begin') return state;
  return match(action)
    .with({ type: 'begin' }, ({ settings }) => beginRun(state, settings))
    .with({ type: 'failure' }, ({ code }) => failedState(state, code))
    .with({ type: 'control' }, ({ control }) => requestControl(state, control))
    .with({ type: 'worker-event' }, ({ event }) => reduceWorkerEvent(state, event))
    .exhaustive();
}

function beginRun(state: ProducerState, settings: ProducerSettings): ProducerState {
  return {
    ...state,
    runId: state.runId + 1,
    status: 'initializing',
    pendingSettings: settings,
    metrics: emptyMetrics(settings.instrumentCount),
    error: null,
    stale: false,
    slow: false,
    snapshotAt: null,
    lastSequence: 0,
    runAcknowledged: false,
    pendingControl: null,
  };
}

function requestControl(state: ProducerState, control: ProducerControl): ProducerState {
  if (state.status !== CONTROL_SOURCE_STATUS[control] || state.pendingControl !== null)
    return state;
  return { ...state, pendingControl: control };
}

function reduceWorkerEvent(state: ProducerState, event: ProducerWorkerEvent): ProducerState {
  return match(event)
    .with({ type: 'run-started' }, (value) => acknowledgeRun(state, value))
    .with({ type: 'status-changed' }, (value) => acceptStatus(state, value))
    .with({ type: 'snapshot' }, (value) => acceptSnapshot(state, value))
    .with({ type: 'run-error' }, (value) => failedState(state, value.code))
    .with({ type: 'pace-changed' }, (value) => acceptPace(state, value))
    .exhaustive();
}

function acknowledgeRun(state: ProducerState, event: RunStartedEvent): ProducerState {
  if (
    state.runAcknowledged ||
    state.status !== 'initializing' ||
    !sameProducerSettings(event.activeSettings, state.pendingSettings)
  ) {
    return failedState(state, 'protocol');
  }
  return {
    ...state,
    runAcknowledged: true,
    activeSettings: copyProducerSettings(event.activeSettings),
  };
}

function acceptStatus(state: ProducerState, event: StatusChangedEvent): ProducerState {
  const transition = STATUS_TRANSITIONS[event.status].find(
    (candidate) => candidate.from === state.status && candidate.allowed(state),
  );
  return transition?.enter(state) ?? failedState(state, 'protocol');
}

function acceptSnapshot(state: ProducerState, event: SnapshotEvent): ProducerState {
  if (!SNAPSHOT_RULES.every((rule) => rule(state, event))) return failedState(state, 'protocol');
  try {
    return {
      ...state,
      metrics: event.metrics.map((metric) => ({
        instrument: metric.instrument,
        lastPriceCents: fromNullableDecimalString(metric.lastPriceCents),
        spreadCents: fromNullableDecimalString(metric.spreadCents),
        volume: metric.volume,
        vwapCents: fromNullableDecimalString(metric.vwapCents),
        imbalance: fromNullableDecimalString(metric.imbalance),
      })),
      lastSequence: event.sequence,
      snapshotAt: event.timestampMs,
    };
  } catch {
    return failedState(state, 'metric-failure');
  }
}

function acceptPace(state: ProducerState, event: PaceChangedEvent): ProducerState {
  if (!state.runAcknowledged || state.status !== 'running') return failedState(state, 'protocol');
  return { ...state, slow: event.slow };
}

function failedState(state: ProducerState, code: ProducerErrorCode): ProducerState {
  const error = describeProducerError(code);
  return {
    ...state,
    ...FAILURE_DATA[error.dataDisposition](state),
    status: 'error',
    error,
    slow: false,
    pendingControl: null,
  };
}
