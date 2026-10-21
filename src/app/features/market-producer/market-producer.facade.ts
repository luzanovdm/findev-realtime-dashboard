import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
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
  take,
  timer,
} from 'rxjs';
import type { Observable } from 'rxjs';
import {
  copyProducerSettings,
  DEFAULT_PRODUCER_SETTINGS,
  isProducerSettings,
} from './producer-settings';
import type { ProducerSettings } from './producer-settings';
import { ProducerSettingsStorage } from './producer-settings-storage';
import { isProducerWorkerEvent } from './generation/worker.protocol';
import type { ProducerWorkerCommand } from './generation/worker.protocol';
import { controlDeadline, INITIAL_PRODUCER_STATE, reduceProducerState } from './producer-state';
import type { ProducerAction, ProducerState } from './producer-state';

const LIVENESS_DEADLINE_MS = 5_000;

export type RunOutcome = 'running' | 'error';

@Injectable({ providedIn: 'root' })
export class MarketProducerFacade {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly settingsStorage = inject(ProducerSettingsStorage);
  private readonly settingsSaveState = signal<'saved' | 'unavailable' | null>(null);
  private readonly actions = new Subject<ProducerAction>();
  private readonly state$ = this.actions.pipe(
    scan(reduceProducerState, INITIAL_PRODUCER_STATE),
    startWith(INITIAL_PRODUCER_STATE),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  private readonly state = toSignal(this.state$, { requireSync: true });

  readonly status = computed(() => this.state().status);
  readonly activeSettings = computed(() => this.state().activeSettings);
  readonly metrics = computed(() => this.state().metrics);
  readonly error = computed(() => this.state().error);
  readonly stale = computed(() => this.state().stale);
  readonly slow = computed(() => this.state().slow);
  readonly snapshotAt = computed(() => this.state().snapshotAt);
  readonly runId = computed(() => this.state().runId);
  readonly settingsSaveStatus = this.settingsSaveState.asReadonly();
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
          deadlineMs: controlDeadline(state),
        })),
        distinctUntilChanged(
          (before, after) => before.runId === after.runId && before.deadlineMs === after.deadlineMs,
        ),
        switchMap(({ runId, deadlineMs }) => {
          if (deadlineMs === null) return EMPTY;
          return timer(deadlineMs).pipe(map(() => runId));
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
      .subscribe(([before, after]) => {
        console.error('Market producer stopped', {
          code: after.error?.code,
          runId: after.runId,
          previousStatus: before.status,
          lastSequence: before.lastSequence,
        });
        this.terminateWorker();
      });
    this.destroyRef.onDestroy(() => this.dispose());
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.beginRun(this.settingsStorage.load() ?? DEFAULT_PRODUCER_SETTINGS);
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
    this.settingsSaveState.set(this.settingsStorage.save(settings) ? 'saved' : 'unavailable');
    this.beginRun(copyProducerSettings(settings));
    return true;
  }

  retry(): boolean {
    return this.apply(this.state().pendingSettings);
  }

  outcomeOf(runId: number): Observable<RunOutcome> {
    return this.state$.pipe(
      filter(
        (state): state is ProducerState & { readonly status: RunOutcome } =>
          state.runId === runId && (state.status === 'running' || state.status === 'error'),
      ),
      map((state) => state.status),
      take(1),
    );
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
      const worker = new Worker(new URL('./generation/producer.worker', import.meta.url), {
        type: 'module',
      });
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
