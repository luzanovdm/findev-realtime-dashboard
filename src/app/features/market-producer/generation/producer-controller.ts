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

interface TransitionStreams {
  start(command: StartRunCommand): Observable<ProducerWorkerEvent>;
  protocolError(runId: number): Observable<ProducerWorkerEvent>;
}

interface RouteState {
  readonly currentRunId: number;
  readonly protocolFailedRunId: number | null;
  readonly disposed: boolean;
  readonly transition: Observable<ProducerWorkerEvent> | null;
}

type RunMode = 'running' | 'paused';
type ControlCommand = Extract<ProducerWorkerCommand, { type: 'pause' | 'resume' }>;

const MODE_FOR_CONTROL = { pause: 'paused', resume: 'running' } as const satisfies Readonly<
  Record<ControlCommand['type'], RunMode>
>;
const MODE_BY_CONTROL: ReadonlyMap<string, RunMode> = new Map(Object.entries(MODE_FOR_CONTROL));

interface ModeInput {
  readonly mode: RunMode;
  readonly initial: boolean;
}
type ActiveChange = (state: ActiveState) => ActiveState;

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
    const transitions = {
      start: (command: StartRunCommand) => this.run(command, commands),
      protocolError: (runId: number) =>
        defer(() => {
          this.reportFailure({ code: 'protocol', runId, stage: 'command' });
          return of({ type: 'run-error', runId, code: 'protocol' } as const);
        }),
    } satisfies TransitionStreams;
    commands
      .pipe(
        scan((state, input) => routeCommand(state, input, transitions), INITIAL_ROUTE_STATE),
        takeWhile((state) => !state.disposed, true),
        filter(
          (state): state is RouteState & { transition: Observable<ProducerWorkerEvent> } =>
            state.transition !== null,
        ),
        map((state) => state.transition),
        switchMap((transition) => transition),
        scan(deduplicateRunError, INITIAL_EMISSION_STATE),
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
    const invalidControl = controlModesForRun(commands, command.runId).pipe(
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
            reduceBatch(
              state,
              updates,
              command.runId,
              command.settings.updatesPerBatch,
              intervalMs,
              this.dependencies,
            ),
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

    const initial: ActiveState = {
      metrics: createMetricState(command.settings.instrumentCount),
      sequence: 0,
      publishedSequence: 0,
      lastPublishedAt: null,
      pace: INITIAL_PACE,
      events: [],
    };
    return modes.pipe(
      switchMap((input) => modeStreams[input.mode](input)),
      scan((state, change) => change(state), initial),
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

function controlModesForRun(
  commands: Observable<CommandInput>,
  runId: number,
): Observable<RunMode> {
  return commands.pipe(
    filter((input): input is Extract<CommandInput, { kind: 'valid' }> => input.kind === 'valid'),
    map((input) => input.command),
    filter((command) => command.runId === runId),
    map((command) => MODE_BY_CONTROL.get(command.type)),
    filter((mode): mode is RunMode => mode !== undefined),
  );
}

function routeCommand(
  state: RouteState,
  input: CommandInput,
  transitions: TransitionStreams,
): RouteState {
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
      transition: transitions.protocolError(input.runId),
    };
  }

  const command = input.command;
  if (command.type === 'start-run' && command.runId > state.currentRunId) {
    return {
      currentRunId: command.runId,
      protocolFailedRunId: null,
      disposed: false,
      transition: transitions.start(command),
    };
  }
  if (command.type === 'dispose' && command.runId === state.currentRunId) {
    return { ...state, disposed: true, transition: EMPTY };
  }
  return { ...state, transition: null };
}

function deduplicateRunError(state: EmissionState, event: ProducerWorkerEvent): EmissionState {
  if (event.type !== 'run-error') return { ...state, event };
  if (state.failedRunId === event.runId) return { ...state, event: null };
  return { failedRunId: event.runId, event };
}

function resumeState(state: ActiveState, runId: number): ActiveState {
  return {
    ...state,
    pace: INITIAL_PACE,
    events: [{ type: 'status-changed', runId, status: 'running' }],
  };
}

function pauseState(
  state: ActiveState,
  runId: number,
  dependencies: ControllerDependencies,
): ActiveState {
  const publishPending = state.sequence > state.publishedSequence;
  const events = [
    { include: publishPending, create: () => makeSnapshot(state, runId, dependencies) },
    {
      include: state.pace.slow,
      create: (): ProducerWorkerEvent => ({ type: 'pace-changed', runId, slow: false }),
    },
    {
      include: true,
      create: (): ProducerWorkerEvent => ({ type: 'status-changed', runId, status: 'paused' }),
    },
  ]
    .filter(({ include }) => include)
    .map(({ create }) => create());
  return {
    ...state,
    publishedSequence: state.sequence,
    lastPublishedAt: publishPending ? dependencies.now() : state.lastPublishedAt,
    pace: INITIAL_PACE,
    events,
  };
}

function reduceBatch(
  state: ActiveState,
  updates: ReturnType<GeneratorPort['generateBatch']>,
  runId: number,
  batchSize: number,
  intervalMs: number,
  dependencies: ControllerDependencies,
): ActiveState {
  if (updates.length !== batchSize) throw new ProducerFault('protocol');
  const metrics = accumulateMetricBatch(state.metrics, updates);
  const sequence = state.sequence + 1;
  const now = dependencies.now();
  const pace = measurePace(state.pace, now, intervalMs);
  const publish = state.lastPublishedAt === null || now - state.lastPublishedAt >= 100;
  const next = { ...state, metrics, pace, sequence };
  const events = [
    { include: publish, create: () => makeSnapshot(next, runId, dependencies) },
    {
      include: pace.slow !== state.pace.slow,
      create: (): ProducerWorkerEvent => ({ type: 'pace-changed', runId, slow: pace.slow }),
    },
  ]
    .filter(({ include }) => include)
    .map(({ create }) => create());
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
