import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class MarketProducerFacade {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly statusState = signal<ProducerStatus>('initializing');
  private readonly activeSettingsState = signal<ProducerSettings>(DEFAULT_PRODUCER_SETTINGS);
  private readonly metricsState = signal<readonly InstrumentMetricSnapshot[]>(
    emptyMetrics(DEFAULT_PRODUCER_SETTINGS.instrumentCount),
  );
  private readonly errorState = signal<ProducerError | null>(null);
  private readonly staleState = signal(false);
  private readonly snapshotAtState = signal<number | null>(null);
  private readonly runIdState = signal(0);
  private readonly pendingCommandState = signal<'pause' | 'resume' | null>(null);

  readonly status = this.statusState.asReadonly();
  readonly activeSettings = this.activeSettingsState.asReadonly();
  readonly metrics = this.metricsState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly stale = this.staleState.asReadonly();
  readonly snapshotAt = this.snapshotAtState.asReadonly();
  readonly runId = this.runIdState.asReadonly();
  readonly canPause = computed(
    () => this.status() === 'running' && this.pendingCommandState() === null,
  );
  readonly canResume = computed(
    () => this.status() === 'paused' && this.pendingCommandState() === null,
  );

  private started = false;
  private disposed = false;
  private worker: Worker | null = null;
  private pendingSettings: ProducerSettings = DEFAULT_PRODUCER_SETTINGS;
  private runAcknowledged = false;
  private lastSequence = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private liveness: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.dispose());
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.beginRun(DEFAULT_PRODUCER_SETTINGS);
  }

  pause(): void {
    if (!this.canPause()) return;
    this.pendingCommandState.set('pause');
    this.send({ type: 'pause', runId: this.runId() });
    if (this.status() !== 'error') this.armDeadline(COMMAND_DEADLINE_MS);
  }

  resume(): void {
    if (!this.canResume()) return;
    this.pendingCommandState.set('resume');
    this.send({ type: 'resume', runId: this.runId() });
    if (this.status() !== 'error') this.armDeadline(COMMAND_DEADLINE_MS);
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
    return this.apply(this.pendingSettings);
  }

  private beginRun(settings: ProducerSettings): void {
    this.clearTimers();
    this.pendingCommandState.set(null);
    this.pendingSettings = settings;
    this.runAcknowledged = false;
    this.lastSequence = 0;
    this.runIdState.update((id) => id + 1);
    this.statusState.set('initializing');
    this.errorState.set(null);
    this.staleState.set(false);
    this.snapshotAtState.set(null);
    this.metricsState.set(emptyMetrics(settings.instrumentCount));

    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      this.fail('worker-unavailable');
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
      if (this.status() !== 'error') this.armDeadline(INITIALIZATION_DEADLINE_MS);
    } catch {
      this.fail('worker-unavailable');
    }
  }

  private ensureWorker(): boolean {
    if (this.worker !== null) return true;
    try {
      const worker = new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<unknown>) => this.receive(data);
      worker.onerror = () => this.fail('worker-crash');
      worker.onmessageerror = () => this.fail('protocol');
      this.worker = worker;
      return true;
    } catch {
      this.fail('worker-unavailable');
      return false;
    }
  }

  private send(command: ProducerWorkerCommand): void {
    try {
      this.worker?.postMessage(command);
    } catch {
      this.fail('worker-crash');
    }
  }

  private receive(value: unknown): void {
    if (this.disposed || this.status() === 'error') return;
    if (typeof value === 'object' && value !== null && 'runId' in value) {
      if (typeof value.runId === 'number' && value.runId < this.runId()) return;
    }
    if (!isProducerWorkerEvent(value) || value.runId !== this.runId()) {
      this.fail('protocol');
      return;
    }

    try {
      this.acceptEvent(value);
    } catch {
      this.fail('metric-failure');
    }
  }

  private acceptEvent(event: ProducerWorkerEvent): void {
    switch (event.type) {
      case 'run-started':
        if (
          this.runAcknowledged ||
          this.status() !== 'initializing' ||
          !sameSettings(event.activeSettings, this.pendingSettings)
        ) {
          this.fail('protocol');
          return;
        }
        this.runAcknowledged = true;
        this.activeSettingsState.set(copyProducerSettings(event.activeSettings));
        return;
      case 'status-changed':
        this.acceptStatus(event.status);
        return;
      case 'snapshot':
        if (
          !this.runAcknowledged ||
          this.status() !== 'running' ||
          event.sequence <= this.lastSequence ||
          event.metrics.length !== this.activeSettings().instrumentCount ||
          event.metrics.some((metric, index) => metric.instrument !== instrumentSymbol(index))
        ) {
          this.fail('protocol');
          return;
        }
        this.metricsState.set(
          event.metrics.map((metric) => ({
            instrument: metric.instrument,
            lastPriceCents:
              metric.lastPriceCents === null ? null : financialDecimal(metric.lastPriceCents),
            spreadCents: metric.spreadCents === null ? null : financialDecimal(metric.spreadCents),
            volume: metric.volume,
            vwapCents: metric.vwapCents === null ? null : financialDecimal(metric.vwapCents),
            imbalance: metric.imbalance === null ? null : financialDecimal(metric.imbalance),
          })),
        );
        this.lastSequence = event.sequence;
        this.snapshotAtState.set(event.timestampMs);
        this.armLiveness();
        return;
      case 'run-error':
        this.fail(event.code);
        return;
    }
  }

  private acceptStatus(status: ProducerStatus): void {
    if (status === 'initializing' && this.status() === 'initializing') return;
    if (
      status === 'running' &&
      this.runAcknowledged &&
      (this.status() === 'initializing' ||
        (this.status() === 'paused' && this.pendingCommandState() === 'resume'))
    ) {
      this.pendingCommandState.set(null);
      this.statusState.set('running');
      this.clearDeadline();
      this.armLiveness();
      return;
    }
    if (
      status === 'paused' &&
      this.status() === 'running' &&
      this.pendingCommandState() === 'pause'
    ) {
      this.pendingCommandState.set(null);
      this.statusState.set('paused');
      this.clearTimers();
      return;
    }
    this.fail('protocol');
  }

  private fail(code: ProducerErrorCode): void {
    if (this.disposed || this.status() === 'error') return;
    const error = describeProducerError(code);
    this.clearTimers();
    this.pendingCommandState.set(null);
    this.statusState.set('error');
    this.errorState.set(error);
    if (error.dataDisposition === 'hide') {
      this.metricsState.set(emptyMetrics(this.pendingSettings.instrumentCount));
      this.snapshotAtState.set(null);
    }
    this.staleState.set(error.dataDisposition === 'stale' && this.snapshotAt() !== null);
    this.terminateWorker();
  }

  private armDeadline(delayMs: number): void {
    this.clearDeadline();
    const runId = this.runId();
    this.deadline = setTimeout(() => {
      if (runId === this.runId() && this.status() !== 'error') this.fail('worker-timeout');
    }, delayMs);
  }

  private armLiveness(): void {
    this.clearLiveness();
    if (this.status() !== 'running' || this.document.visibilityState === 'hidden') return;
    const runId = this.runId();
    this.liveness = setTimeout(() => {
      if (runId === this.runId() && this.status() === 'running') this.fail('worker-timeout');
    }, LIVENESS_DEADLINE_MS);
  }

  private readonly onVisibilityChange = (): void => {
    this.armLiveness();
  };

  private clearDeadline(): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private clearLiveness(): void {
    if (this.liveness !== null) clearTimeout(this.liveness);
    this.liveness = null;
  }

  private clearTimers(): void {
    this.clearDeadline();
    this.clearLiveness();
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
    this.clearTimers();
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.terminateWorker();
  }
}

function sameSettings(first: ProducerSettings, second: ProducerSettings): boolean {
  return (
    first.instrumentCount === second.instrumentCount &&
    first.updatesPerBatch === second.updatesPerBatch &&
    first.batchIntervalMs === second.batchIntervalMs
  );
}
