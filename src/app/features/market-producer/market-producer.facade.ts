import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  filter,
  fromEvent,
  map,
  pairwise,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  timer,
} from 'rxjs';
import { financialDecimal } from './financial-decimal';
import type {
  InstrumentMetricSnapshot,
  ProducerError,
  ProducerErrorCode,
  ProducerStatus,
} from './market-producer.types';
import { instrumentSymbol } from './market-producer.types';
import { describeProducerError } from './producer-error';
import {
  copyProducerSettings,
  DEFAULT_PRODUCER_SETTINGS,
  isProducerSettings,
} from './producer-settings';
import type { ProducerSettings } from './producer-settings';
import { isProducerWorkerEvent } from './worker.protocol';
import type { ProducerWorkerCommand, ProducerWorkerEvent } from './worker.protocol';

const INITIALIZATION_DEADLINE_MS = 5_000;
const COMMAND_DEADLINE_MS = 2_000;
const LIVENESS_DEADLINE_MS = 5_000;

interface ProducerState {
  readonly runId: number;
  readonly status: ProducerStatus;
  readonly activeSettings: ProducerSettings;
  readonly pendingSettings: ProducerSettings;
  readonly metrics: readonly InstrumentMetricSnapshot[];
  readonly error: ProducerError | null;
  readonly stale: boolean;
  readonly snapshotAt: number | null;
  readonly lastSequence: number;
  readonly runAcknowledged: boolean;
  readonly pendingControl: 'pause' | 'resume' | null;
}

type ProducerAction =
  | { readonly type: 'begin'; readonly settings: ProducerSettings }
  | { readonly type: 'control'; readonly control: 'pause' | 'resume' }
  | { readonly type: 'worker-event'; readonly event: ProducerWorkerEvent }
  | { readonly type: 'failure'; readonly code: ProducerErrorCode };

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

const INITIAL_STATE: ProducerState = {
  runId: 0,
  status: 'initializing',
  activeSettings: DEFAULT_PRODUCER_SETTINGS,
  pendingSettings: DEFAULT_PRODUCER_SETTINGS,
  metrics: emptyMetrics(DEFAULT_PRODUCER_SETTINGS.instrumentCount),
  error: null,
  stale: false,
  snapshotAt: null,
  lastSequence: 0,
  runAcknowledged: false,
  pendingControl: null,
};

@Injectable({ providedIn: 'root' })
export class MarketProducerFacade {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly actions = new Subject<ProducerAction>();
  private readonly state$ = this.actions.pipe(
    scan(reduceProducerState, INITIAL_STATE),
    startWith(INITIAL_STATE),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  private readonly state = toSignal(this.state$, { requireSync: true });

  readonly status = computed(() => this.state().status);
  readonly activeSettings = computed(() => this.state().activeSettings);
  readonly metrics = computed(() => this.state().metrics);
  readonly error = computed(() => this.state().error);
  readonly stale = computed(() => this.state().stale);
  readonly snapshotAt = computed(() => this.state().snapshotAt);
  readonly runId = computed(() => this.state().runId);
  readonly canPause = computed(
    () => this.status() === 'running' && this.state().pendingControl === null,
  );
  readonly canResume = computed(
    () => this.status() === 'paused' && this.state().pendingControl === null,
  );

  private started = false;
  private disposed = false;
  private worker: Worker | null = null;

  constructor() {
    this.state$
      .pipe(
        map((state) => ({
          runId: state.runId,
          status: state.status,
          pendingControl: state.pendingControl,
        })),
        distinctUntilChanged(
          (before, after) =>
            before.runId === after.runId &&
            before.status === after.status &&
            before.pendingControl === after.pendingControl,
        ),
        switchMap(({ runId, status, pendingControl }) => {
          if (runId === 0 || status === 'error') return EMPTY;
          const delayMs =
            status === 'initializing'
              ? INITIALIZATION_DEADLINE_MS
              : pendingControl === null
                ? null
                : COMMAND_DEADLINE_MS;
          return delayMs === null ? EMPTY : timer(delayMs).pipe(map(() => runId));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((runId) => {
        if (runId === this.runId()) this.actions.next({ type: 'failure', code: 'worker-timeout' });
      });

    const visible$ = fromEvent(this.document, 'visibilitychange').pipe(
      map(() => this.document.visibilityState),
      startWith(this.document.visibilityState),
      distinctUntilChanged(),
    );
    const progress$ = this.state$.pipe(
      map((state) => ({ runId: state.runId, status: state.status, sequence: state.lastSequence })),
      distinctUntilChanged(
        (before, after) =>
          before.runId === after.runId &&
          before.status === after.status &&
          before.sequence === after.sequence,
      ),
    );
    combineLatest([progress$, visible$])
      .pipe(
        switchMap(([progress, visibility]) =>
          progress.runId > 0 && progress.status === 'running' && visibility !== 'hidden'
            ? timer(LIVENESS_DEADLINE_MS).pipe(map(() => progress.runId))
            : EMPTY,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((runId) => {
        if (runId === this.runId() && this.status() === 'running') {
          this.actions.next({ type: 'failure', code: 'worker-timeout' });
        }
      });

    this.state$
      .pipe(
        pairwise(),
        filter(([before, after]) => before.status !== 'error' && after.status === 'error'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.terminateWorker());
    this.destroyRef.onDestroy(() => this.dispose());
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.beginRun(DEFAULT_PRODUCER_SETTINGS);
  }

  pause(): void {
    if (!this.canPause()) return;
    this.actions.next({ type: 'control', control: 'pause' });
    this.send({ type: 'pause', runId: this.runId() });
  }

  resume(): void {
    if (!this.canResume()) return;
    this.actions.next({ type: 'control', control: 'resume' });
    this.send({ type: 'resume', runId: this.runId() });
  }

  apply(settings: ProducerSettings): boolean {
    if (
      !this.started ||
      this.disposed ||
      !isProducerSettings(settings) ||
      this.status() === 'initializing' ||
      this.error()?.recoveryAction === 'none'
    ) {
      return false;
    }
    this.beginRun(copyProducerSettings(settings));
    return true;
  }

  retry(): boolean {
    return this.apply(this.state().pendingSettings);
  }

  private beginRun(settings: ProducerSettings): void {
    this.actions.next({ type: 'begin', settings });
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      this.actions.next({ type: 'failure', code: 'worker-unavailable' });
      return;
    }
    if (!this.ensureWorker()) return;

    try {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 0x6d2b79f5;
      this.send({
        type: 'start-run',
        runId: this.runId(),
        settings,
        seed,
        wasmUrl: new URL('wasm/market-generator.wasm', this.document.baseURI).href,
      });
    } catch {
      this.actions.next({ type: 'failure', code: 'worker-unavailable' });
    }
  }

  private ensureWorker(): boolean {
    if (this.worker !== null) return true;
    try {
      const worker = new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<unknown>) => this.receive(data);
      worker.onerror = () => this.actions.next({ type: 'failure', code: 'worker-crash' });
      worker.onmessageerror = () => this.actions.next({ type: 'failure', code: 'protocol' });
      this.worker = worker;
      return true;
    } catch {
      this.actions.next({ type: 'failure', code: 'worker-unavailable' });
      return false;
    }
  }

  private send(command: ProducerWorkerCommand): void {
    try {
      this.worker?.postMessage(command);
    } catch {
      this.actions.next({ type: 'failure', code: 'worker-crash' });
    }
  }

  private receive(value: unknown): void {
    if (this.disposed || this.status() === 'error') return;
    if (typeof value === 'object' && value !== null && 'runId' in value) {
      if (typeof value.runId === 'number' && value.runId < this.runId()) return;
    }
    if (!isProducerWorkerEvent(value) || value.runId !== this.runId()) {
      this.actions.next({ type: 'failure', code: 'protocol' });
      return;
    }
    this.actions.next({ type: 'worker-event', event: value });
  }

  private terminateWorker(): void {
    if (this.worker === null) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = null;
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminateWorker();
    this.actions.complete();
  }
}

function reduceProducerState(state: ProducerState, action: ProducerAction): ProducerState {
  if (action.type === 'begin') {
    return {
      ...state,
      runId: state.runId + 1,
      status: 'initializing',
      pendingSettings: action.settings,
      metrics: emptyMetrics(action.settings.instrumentCount),
      error: null,
      stale: false,
      snapshotAt: null,
      lastSequence: 0,
      runAcknowledged: false,
      pendingControl: null,
    };
  }
  if (state.status === 'error') return state;
  if (action.type === 'failure') return failedState(state, action.code);
  if (action.type === 'control') {
    if (
      (action.control === 'pause' && state.status !== 'running') ||
      (action.control === 'resume' && state.status !== 'paused') ||
      state.pendingControl !== null
    ) {
      return state;
    }
    return { ...state, pendingControl: action.control };
  }

  const event = action.event;
  switch (event.type) {
    case 'run-started':
      return !state.runAcknowledged &&
        state.status === 'initializing' &&
        sameSettings(event.activeSettings, state.pendingSettings)
        ? {
            ...state,
            runAcknowledged: true,
            activeSettings: copyProducerSettings(event.activeSettings),
          }
        : failedState(state, 'protocol');
    case 'status-changed':
      if (event.status === 'initializing' && state.status === 'initializing') return state;
      if (
        event.status === 'running' &&
        state.runAcknowledged &&
        (state.status === 'initializing' ||
          (state.status === 'paused' && state.pendingControl === 'resume'))
      ) {
        return { ...state, status: 'running', pendingControl: null };
      }
      if (
        event.status === 'paused' &&
        state.status === 'running' &&
        state.pendingControl === 'pause'
      ) {
        return { ...state, status: 'paused', pendingControl: null };
      }
      return failedState(state, 'protocol');
    case 'snapshot':
      if (
        !state.runAcknowledged ||
        state.status !== 'running' ||
        event.sequence <= state.lastSequence ||
        event.metrics.length !== state.activeSettings.instrumentCount ||
        event.metrics.some((metric, index) => metric.instrument !== instrumentSymbol(index))
      ) {
        return failedState(state, 'protocol');
      }
      try {
        return {
          ...state,
          metrics: event.metrics.map((metric) => ({
            instrument: metric.instrument,
            lastPriceCents:
              metric.lastPriceCents === null ? null : financialDecimal(metric.lastPriceCents),
            spreadCents: metric.spreadCents === null ? null : financialDecimal(metric.spreadCents),
            volume: metric.volume,
            vwapCents: metric.vwapCents === null ? null : financialDecimal(metric.vwapCents),
            imbalance: metric.imbalance === null ? null : financialDecimal(metric.imbalance),
          })),
          lastSequence: event.sequence,
          snapshotAt: event.timestampMs,
        };
      } catch {
        return failedState(state, 'metric-failure');
      }
    case 'run-error':
      return failedState(state, event.code);
  }
}

function failedState(state: ProducerState, code: ProducerErrorCode): ProducerState {
  const error = describeProducerError(code);
  const hide = error.dataDisposition === 'hide';
  return {
    ...state,
    status: 'error',
    error,
    metrics: hide ? emptyMetrics(state.pendingSettings.instrumentCount) : state.metrics,
    snapshotAt: hide ? null : state.snapshotAt,
    stale: !hide && state.snapshotAt !== null,
    pendingControl: null,
  };
}

function sameSettings(first: ProducerSettings, second: ProducerSettings): boolean {
  return (
    first.instrumentCount === second.instrumentCount &&
    first.updatesPerBatch === second.updatesPerBatch &&
    first.batchIntervalMs === second.batchIntervalMs
  );
}
