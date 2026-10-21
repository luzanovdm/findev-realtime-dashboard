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
  takeWhile,
  timer,
} from 'rxjs';
import type { Observable, SchedulerLike } from 'rxjs';
import {
  accumulateMetricBatch,
  createMetricState,
  serializedMetricSnapshot,
} from '../metrics/metric-accumulator';
import type { MetricState } from '../metrics/metric-accumulator';
import { producerErrorCode, ProducerFault } from '../producer-error';
import type { GeneratorPort } from './wasm-generator';
import { isProducerWorkerCommand } from './worker.protocol';
import type {
  ProducerWorkerCommand,
  ProducerWorkerEvent,
  StartRunCommand,
} from './worker.protocol';

export interface ProducerDiagnostic {
  readonly code: ReturnType<typeof producerErrorCode>;
  readonly runId: number;
  readonly stage: 'command' | 'initialization' | 'generation';
  readonly cause?: unknown;
}

export interface ControllerDependencies {
  load(url: string, signal: AbortSignal): Promise<GeneratorPort>;
  emit(event: ProducerWorkerEvent): void;
  reportFailure?(diagnostic: ProducerDiagnostic): void;
  scheduler?: SchedulerLike;
  now(): number;
  timestampMs(): number;
}

type CommandInput =
  | { readonly kind: 'valid'; readonly command: ProducerWorkerCommand }
  | { readonly kind: 'malformed'; readonly runId: number | null };

type RunTransition =
  | { readonly kind: 'start'; readonly command: StartRunCommand }
  | { readonly kind: 'protocol-error'; readonly runId: number }
  | { readonly kind: 'dispose' };

interface RouteState {
  readonly currentRunId: number;
  readonly protocolFailedRunId: number | null;
  readonly disposed: boolean;
  readonly transition: RunTransition | null;
}

type RunMode = 'running' | 'paused';
type ControlCommand = Extract<ProducerWorkerCommand, { type: 'pause' | 'resume' }>;

const MODE_FOR_CONTROL = { pause: 'paused', resume: 'running' } as const satisfies Readonly<
  Record<ControlCommand['type'], RunMode>
>;

type ActiveInput =
  | { readonly kind: 'mode'; readonly mode: RunMode; readonly initial: boolean }
  | { readonly kind: 'batch'; readonly updates: ReturnType<GeneratorPort['generateBatch']> };
type ModeInput = Extract<ActiveInput, { kind: 'mode' }>;

interface ActiveState {
  readonly metrics: MetricState;
  readonly sequence: number;
  readonly publishedSequence: number;
  readonly lastPublishedAt: number | null;
  readonly pace: PaceState;
  readonly events: readonly ProducerWorkerEvent[];
}

interface PaceState {
  readonly lastBatchAt: number | null;
  readonly lateIntervals: number;
  readonly timelyIntervals: number;
  readonly slow: boolean;
}

const INITIAL_PACE: PaceState = {
  lastBatchAt: null,
  lateIntervals: 0,
  timelyIntervals: 0,
  slow: false,
};

interface EmissionState {
  readonly failedRunId: number | null;
  readonly event: ProducerWorkerEvent | null;
}

const INITIAL_ROUTE_STATE: RouteState = {
  currentRunId: 0,
  protocolFailedRunId: null,
  disposed: false,
  transition: null,
};

const INITIAL_EMISSION_STATE: EmissionState = { failedRunId: null, event: null };

export class ProducerController {
  private readonly input = new Subject<unknown>();

  constructor(private readonly dependencies: ControllerDependencies) {
    const commands = this.input.pipe(map(decodeCommand), share());
    commands
      .pipe(
        scan(routeCommand, INITIAL_ROUTE_STATE),
        takeWhile((state) => !state.disposed, true),
        filter(
          (state): state is RouteState & { transition: RunTransition } => state.transition !== null,
        ),
        map((state) => state.transition),
        switchMap((transition): Observable<ProducerWorkerEvent> => {
          switch (transition.kind) {
            case 'start':
              return this.run(transition.command, commands);
            case 'protocol-error':
              this.reportFailure({
                code: 'protocol',
                runId: transition.runId,
                stage: 'command',
              });
              return of({ type: 'run-error', runId: transition.runId, code: 'protocol' });
            case 'dispose':
              return EMPTY;
          }
        }),
        scan(
          (state, event): EmissionState =>
            event.type === 'run-error' && state.failedRunId === event.runId
              ? { ...state, event: null }
              : {
                  failedRunId: event.type === 'run-error' ? event.runId : state.failedRunId,
                  event,
                },
          INITIAL_EMISSION_STATE,
        ),
        filter(
          (state): state is EmissionState & { event: ProducerWorkerEvent } => state.event !== null,
        ),
        map((state) => state.event),
      )
      .subscribe((event) => dependencies.emit(event));
  }

  dispatch(value: unknown): void {
    this.input.next(value);
  }

  private run(
    command: StartRunCommand,
    commands: Observable<CommandInput>,
  ): Observable<ProducerWorkerEvent> {
    const abortController = new AbortController();
    const invalidControl = commands.pipe(
      filter(
        (input) =>
          input.kind === 'valid' &&
          input.command.runId === command.runId &&
          (input.command.type === 'pause' || input.command.type === 'resume'),
      ),
      map((): GeneratorPort => {
        throw new ProducerFault('protocol');
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
    const scheduler = this.dependencies.scheduler ?? asyncScheduler;
    const modes = commands.pipe(
      filter(
        (input): input is { kind: 'valid'; command: ControlCommand } =>
          input.kind === 'valid' &&
          input.command.runId === command.runId &&
          (input.command.type === 'pause' || input.command.type === 'resume'),
      ),
      map((input) => MODE_FOR_CONTROL[input.command.type]),
      startWith('running' as const),
      distinctUntilChanged(),
      map((mode, index): ModeInput => ({ kind: 'mode', mode, initial: index === 0 })),
    );

    const initial: ActiveState = {
      metrics: createMetricState(command.settings.instrumentCount),
      sequence: 0,
      publishedSequence: 0,
      lastPublishedAt: null,
      pace: INITIAL_PACE,
      events: [],
    };
    return modes.pipe(
      switchMap((input) => {
        if (input.mode === 'paused') return of(input);
        const batch = defer(() =>
          of(generator.generateBatch(command.settings.updatesPerBatch)),
        ).pipe(
          repeat({ delay: () => timer(intervalMs, scheduler) }),
          map((updates): ActiveInput => ({ kind: 'batch', updates })),
        );
        const scheduled = input.initial
          ? batch
          : timer(intervalMs, scheduler).pipe(switchMap(() => batch));
        return concat(of(input), scheduled);
      }),
      scan(
        (state, input) =>
          reduceActive(
            state,
            input,
            command.runId,
            command.settings.updatesPerBatch,
            command.settings.batchIntervalMs,
            this.dependencies,
          ),
        initial,
      ),
      mergeMap((state) => from(state.events)),
      catchError((error: unknown) => of(this.failureEvent(command.runId, 'generation', error))),
    );
  }

  private failureEvent(
    runId: number,
    stage: 'initialization' | 'generation',
    cause: unknown,
  ): ProducerWorkerEvent {
    const code = producerErrorCode(cause, 'generation');
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

function decodeCommand(value: unknown): CommandInput {
  if (isProducerWorkerCommand(value)) return { kind: 'valid', command: value };
  if (typeof value !== 'object' || value === null || !('runId' in value)) {
    return { kind: 'malformed', runId: null };
  }
  const runId = value.runId;
  return {
    kind: 'malformed',
    runId: typeof runId === 'number' && Number.isSafeInteger(runId) && runId >= 1 ? runId : null,
  };
}

function routeCommand(state: RouteState, input: CommandInput): RouteState {
  if (state.disposed) return { ...state, transition: null };
  if (input.kind === 'malformed') {
    if (
      input.runId === null ||
      input.runId < state.currentRunId ||
      input.runId === state.protocolFailedRunId
    ) {
      return { ...state, transition: null };
    }
    return {
      currentRunId: input.runId,
      protocolFailedRunId: input.runId,
      disposed: false,
      transition: { kind: 'protocol-error', runId: input.runId },
    };
  }

  const command = input.command;
  if (command.type === 'start-run' && command.runId > state.currentRunId) {
    return {
      currentRunId: command.runId,
      protocolFailedRunId: null,
      disposed: false,
      transition: { kind: 'start', command },
    };
  }
  if (command.type === 'dispose' && command.runId === state.currentRunId) {
    return { ...state, disposed: true, transition: { kind: 'dispose' } };
  }
  return { ...state, transition: null };
}

function reduceActive(
  state: ActiveState,
  input: ActiveInput,
  runId: number,
  batchSize: number,
  intervalMs: number,
  dependencies: ControllerDependencies,
): ActiveState {
  if (input.kind === 'mode') {
    if (input.mode === 'running') {
      return {
        ...state,
        pace: INITIAL_PACE,
        events: [{ type: 'status-changed', runId, status: 'running' }],
      };
    }
    const snapshot =
      state.sequence > state.publishedSequence ? [makeSnapshot(state, runId, dependencies)] : [];
    const paceClear: ProducerWorkerEvent[] = state.pace.slow
      ? [{ type: 'pace-changed', runId, slow: false }]
      : [];
    return {
      ...state,
      publishedSequence: state.sequence,
      lastPublishedAt: snapshot.length > 0 ? dependencies.now() : state.lastPublishedAt,
      pace: INITIAL_PACE,
      events: [...snapshot, ...paceClear, { type: 'status-changed', runId, status: 'paused' }],
    };
  }

  if (input.updates.length !== batchSize) throw new ProducerFault('protocol');
  const metrics = accumulateMetricBatch(state.metrics, input.updates);
  const sequence = state.sequence + 1;
  const now = dependencies.now();
  const pace = measurePace(state.pace, now, intervalMs);
  const publish = state.lastPublishedAt === null || now - state.lastPublishedAt >= 100;
  const next = { ...state, metrics, pace, sequence };
  const paceChanged: ProducerWorkerEvent[] =
    pace.slow === state.pace.slow ? [] : [{ type: 'pace-changed', runId, slow: pace.slow }];
  return {
    ...next,
    publishedSequence: publish ? sequence : state.publishedSequence,
    lastPublishedAt: publish ? now : state.lastPublishedAt,
    events: [...(publish ? [makeSnapshot(next, runId, dependencies)] : []), ...paceChanged],
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

function makeSnapshot(
  state: ActiveState,
  runId: number,
  dependencies: ControllerDependencies,
): ProducerWorkerEvent {
  return {
    type: 'snapshot',
    runId,
    sequence: state.sequence,
    timestampMs: dependencies.timestampMs(),
    metrics: serializedMetricSnapshot(state.metrics),
  };
}
