import {
  asyncScheduler,
  catchError,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  from,
  map,
  mergeMap,
  of,
  race,
  repeat,
  scan,
  share,
  startWith,
  Subject,
  switchMap,
  tap,
  takeWhile,
  timer,
} from 'rxjs';
import type { Observable, SchedulerLike, Subscription } from 'rxjs';
import { match } from 'ts-pattern';
import { createActiveState, pauseState, reduceBatch, resumeState } from './active-run-state';
import type { ActiveState, RunClock } from './active-run-state';
import {
  controlModesForRun,
  decodeCommand,
  INITIAL_ROUTE_STATE,
  routeCommand,
} from './command-routing';
import type { CommandInput, RouteState, RouteTransition, RunMode } from './command-routing';
import { producerErrorCode, ProducerFault } from '../producer-error';
import { ProducerErrorCode } from '../market-producer.types';
import type { GeneratorPort } from './wasm-generator';
import type { ProducerWorkerEvent, StartRunCommand } from './worker.protocol';

export interface ProducerDiagnostic {
  readonly code: ReturnType<typeof producerErrorCode>;
  readonly runId: number;
  readonly stage: 'command' | 'initialization' | 'generation';
  readonly cause?: unknown;
}

export interface ControllerDependencies extends RunClock {
  load(url: string, signal: AbortSignal): Promise<GeneratorPort>;
  emit(event: ProducerWorkerEvent): void;
  reportFailure?(diagnostic: ProducerDiagnostic): void;
  scheduler?: SchedulerLike;
}

interface ModeInput {
  readonly mode: RunMode;
  readonly initial: boolean;
}
type ActiveChange = (state: ActiveState) => ActiveState;

interface EmissionState {
  readonly failedRunId: number | null;
  readonly event: ProducerWorkerEvent | null;
}

const INITIAL_EMISSION_STATE: EmissionState = { failedRunId: null, event: null };

export class ProducerController {
  private readonly input = new Subject<unknown>();
  private readonly subscription: Subscription;
  private currentRunId = 0;
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(private readonly dependencies: ControllerDependencies) {
    const commands = this.input.pipe(map(decodeCommand), share());
    this.subscription = commands
      .pipe(
        scan(routeCommand, INITIAL_ROUTE_STATE),
        tap((state) => (this.currentRunId = state.currentRunId)),
        takeWhile((state) => !state.disposed, true),
        filter(
          (state): state is RouteState & { transition: RouteTransition } =>
            state.transition !== null,
        ),
        map((state) => state.transition),
        switchMap((transition) =>
          match(transition)
            .with({ kind: 'start' }, ({ command }) => this.run(command, commands))
            .with({ kind: 'protocol-error' }, ({ runId }) =>
              defer(() => {
                this.reportFailure({ code: ProducerErrorCode.Protocol, runId, stage: 'command' });
                return of({ type: 'run-error', runId, code: ProducerErrorCode.Protocol } as const);
              }),
            )
            .with({ kind: 'dispose' }, () => EMPTY)
            .exhaustive(),
        ),
        scan(deduplicateRunError, INITIAL_EMISSION_STATE),
        filter(
          (state): state is EmissionState & { event: ProducerWorkerEvent } => state.event !== null,
        ),
        map((state) => state.event),
      )
      .subscribe({
        next: (event) => {
          try {
            dependencies.emit(event);
          } catch (cause: unknown) {
            this.reportFailure({
              code: ProducerErrorCode.Generation,
              runId: event.runId,
              stage: 'generation',
              cause,
            });
            this.dispose();
          }
        },
        error: (cause: unknown) => {
          const runId = this.currentRunId;
          if (runId > 0) {
            this.reportFailure({
              code: ProducerErrorCode.Protocol,
              runId,
              stage: 'command',
              cause,
            });
            try {
              dependencies.emit({ type: 'run-error', runId, code: ProducerErrorCode.Protocol });
            } catch {
              // A disconnected event channel cannot deliver the fallback either.
            }
          }
          this.dispose();
        },
        complete: () => this.dispose(),
      });
  }

  dispatch(value: unknown): void {
    if (this.disposed) return;
    this.input.next(value);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.subscription.unsubscribe();
    this.input.complete();
  }

  private run(
    command: StartRunCommand,
    commands: Observable<CommandInput>,
  ): Observable<ProducerWorkerEvent> {
    const abortController = new AbortController();
    const invalidControl = controlModesForRun(commands, command.runId).pipe(
      map((): GeneratorPort => {
        throw new ProducerFault(ProducerErrorCode.Protocol);
      }),
    );
    return concat(
      of({ type: 'status-changed', runId: command.runId, status: 'initializing' } as const),
      race(
        defer(() => from(this.dependencies.load(command.wasmUrl, abortController.signal))),
        invalidControl,
      ).pipe(
        switchMap((generator) => {
          generator.initialize(command.settings.instrumentCount, command.seed);
          return concat(
            of({
              type: 'run-started',
              runId: command.runId,
              activeSettings: command.settings,
            } as const),
            this.activeRun(command, generator, commands),
          );
        }),
        catchError((error: unknown) =>
          of(this.failureEvent(command.runId, 'initialization', error)),
        ),
        finalize(() => abortController.abort()),
      ),
    );
  }

  private activeRun(
    command: StartRunCommand,
    generator: GeneratorPort,
    commands: Observable<CommandInput>,
  ): Observable<ProducerWorkerEvent> {
    const intervalMs = command.settings.batchIntervalMs;
    const batchContext = {
      runId: command.runId,
      batchSize: command.settings.updatesPerBatch,
      intervalMs,
    };
    const scheduler = this.dependencies.scheduler ?? asyncScheduler;
    const modes = controlModesForRun(commands, command.runId).pipe(
      startWith('running' as const),
      distinctUntilChanged(),
      map((mode, index): ModeInput => ({ mode, initial: index === 0 })),
    );
    const batches = defer(() => of(generator.generateBatch(command.settings.updatesPerBatch))).pipe(
      repeat({ delay: () => timer(intervalMs, scheduler) }),
      map(
        (updates): ActiveChange =>
          (state) =>
            reduceBatch(state, updates, batchContext, this.dependencies),
      ),
    );
    const modeStreams = {
      running: ({ initial }: ModeInput) => {
        const scheduled = initial
          ? batches
          : timer(intervalMs, scheduler).pipe(switchMap(() => batches));
        return concat(
          of((state: ActiveState) => resumeState(state, command.runId)),
          scheduled,
        );
      },
      paused: () => of((state: ActiveState) => pauseState(state, command.runId, this.dependencies)),
    } satisfies Readonly<Record<RunMode, (input: ModeInput) => Observable<ActiveChange>>>;

    const initial = createActiveState(command.settings.instrumentCount);
    return modes.pipe(
      switchMap((input) => modeStreams[input.mode](input)),
      scan((state, change) => change(state), initial),
      mergeMap((state) => from(state.events)),
      catchError((error: unknown) =>
        of(this.failureEvent(command.runId, ProducerErrorCode.Generation, error)),
      ),
    );
  }

  private failureEvent(
    runId: number,
    stage: 'initialization' | 'generation',
    cause: unknown,
  ): ProducerWorkerEvent {
    const code = producerErrorCode(cause, ProducerErrorCode.Generation);
    this.reportFailure({ code, runId, stage, cause });
    return { type: 'run-error', runId, code };
  }

  private reportFailure(diagnostic: ProducerDiagnostic): void {
    try {
      this.dependencies.reportFailure?.(diagnostic);
    } catch {
      // Diagnostics must never replace the typed failure event.
    }
  }
}

function deduplicateRunError(state: EmissionState, event: ProducerWorkerEvent): EmissionState {
  if (event.type !== 'run-error') return { ...state, event };
  if (state.failedRunId === event.runId) return { ...state, event: null };
  return { failedRunId: event.runId, event };
}
