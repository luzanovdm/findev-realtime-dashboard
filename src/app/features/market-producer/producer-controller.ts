import { MetricAccumulator } from './metric-accumulator';
import { producerErrorCode, ProducerFault } from './producer-error';
import type { ProducerStatus } from './market-producer.types';
import type { GeneratorPort } from './wasm-generator';
import { isProducerWorkerCommand } from './worker.protocol';
import type { ProducerWorkerEvent, StartRunCommand } from './worker.protocol';

export interface ControllerDependencies {
  load(url: string, signal: AbortSignal): Promise<GeneratorPort>;
  emit(event: ProducerWorkerEvent): void;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
  now(): number;
  timestampMs(): number;
}

export class ProducerController {
  private runId = 0;
  private status: ProducerStatus | 'idle' | 'disposed' = 'idle';
  private settings: StartRunCommand['settings'] | null = null;
  private generator: GeneratorPort | null = null;
  private metrics: MetricAccumulator | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private sequence = 0;
  private publishedSequence = 0;
  private lastSnapshotAt: number | null = null;

  constructor(private readonly dependencies: ControllerDependencies) {}

  dispatch(value: unknown): void {
    if (!isProducerWorkerCommand(value)) {
      this.rejectMalformedCommand(value);
      return;
    }

    if (value.type === 'start-run') {
      void this.startRun(value);
      return;
    }
    if (value.runId !== this.runId || this.status === 'disposed') return;

    switch (value.type) {
      case 'pause':
        if (this.status === 'paused') return;
        if (this.status !== 'running') return this.fail(value.runId, 'protocol');
        this.stopTimer();
        try {
          this.publishSnapshot(true);
        } catch (error: unknown) {
          return this.fail(value.runId, producerErrorCode(error, 'metric-failure'));
        }
        this.status = 'paused';
        this.dependencies.emit({ type: 'status-changed', runId: value.runId, status: 'paused' });
        return;
      case 'resume':
        if (this.status === 'running') return;
        if (this.status !== 'paused' || this.settings === null) {
          return this.fail(value.runId, 'protocol');
        }
        this.status = 'running';
        this.dependencies.emit({ type: 'status-changed', runId: value.runId, status: 'running' });
        this.scheduleNext(value.runId);
        return;
      case 'dispose':
        this.stopTimer();
        this.abortController?.abort();
        this.abortController = null;
        this.generator = null;
        this.metrics = null;
        this.status = 'disposed';
        return;
    }
  }

  private async startRun(command: StartRunCommand): Promise<void> {
    if (command.runId <= this.runId) return;

    this.stopTimer();
    this.abortController?.abort();
    this.runId = command.runId;
    this.status = 'initializing';
    this.settings = command.settings;
    this.generator = null;
    this.metrics = new MetricAccumulator(command.settings.instrumentCount);
    this.sequence = 0;
    this.publishedSequence = 0;
    this.lastSnapshotAt = null;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.dependencies.emit({
      type: 'status-changed',
      runId: command.runId,
      status: 'initializing',
    });

    try {
      const generator = await this.dependencies.load(command.wasmUrl, abortController.signal);
      if (command.runId !== this.runId || this.status !== 'initializing') return;
      generator.initialize(command.settings.instrumentCount, command.seed);
      this.generator = generator;
      this.status = 'running';
      this.dependencies.emit({
        type: 'run-started',
        runId: command.runId,
        activeSettings: command.settings,
      });
      this.dependencies.emit({ type: 'status-changed', runId: command.runId, status: 'running' });
      this.produce(command.runId);
    } catch (error: unknown) {
      if (command.runId === this.runId) {
        this.fail(command.runId, producerErrorCode(error, 'generation'));
      }
    }
  }

  private produce(runId: number): void {
    if (
      runId !== this.runId ||
      this.status !== 'running' ||
      this.generator === null ||
      this.metrics === null ||
      this.settings === null
    ) {
      return;
    }

    try {
      const updates = this.generator.generateBatch(this.settings.updatesPerBatch);
      if (updates.length !== this.settings.updatesPerBatch) throw new ProducerFault('protocol');
      this.metrics.applyBatch(updates);
      this.sequence++;
      this.publishSnapshot(false);
      this.scheduleNext(runId);
    } catch (error: unknown) {
      this.fail(runId, producerErrorCode(error, 'generation'));
    }
  }

  private publishSnapshot(force: boolean): void {
    if (this.metrics === null || this.sequence === this.publishedSequence) return;
    const now = this.dependencies.now();
    if (!force && this.lastSnapshotAt !== null && now - this.lastSnapshotAt < 100) return;

    const metrics = this.metrics.serializedSnapshot();
    this.dependencies.emit({
      type: 'snapshot',
      runId: this.runId,
      sequence: this.sequence,
      timestampMs: this.dependencies.timestampMs(),
      metrics,
    });
    this.publishedSequence = this.sequence;
    this.lastSnapshotAt = now;
  }

  private scheduleNext(runId: number): void {
    if (this.status !== 'running' || this.settings === null) return;
    this.timer = this.dependencies.schedule(() => {
      this.timer = null;
      this.produce(runId);
    }, this.settings.batchIntervalMs);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.dependencies.cancel(this.timer);
    this.timer = null;
  }

  private fail(runId: number, code: Parameters<typeof producerErrorCode>[1]): void {
    if (runId !== this.runId || this.status === 'error' || this.status === 'disposed') return;
    this.stopTimer();
    this.abortController?.abort();
    this.abortController = null;
    this.generator = null;
    this.status = 'error';
    this.dependencies.emit({ type: 'run-error', runId, code });
  }

  private rejectMalformedCommand(value: unknown): void {
    if (typeof value !== 'object' || value === null || !('runId' in value)) return;
    const runId = value.runId;
    if (
      typeof runId !== 'number' ||
      !Number.isSafeInteger(runId) ||
      runId < 1 ||
      runId < this.runId
    ) {
      return;
    }
    if (runId > this.runId) {
      this.stopTimer();
      this.abortController?.abort();
      this.runId = runId;
      this.status = 'initializing';
    }
    this.fail(runId, 'protocol');
  }
}
