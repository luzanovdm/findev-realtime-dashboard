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
  merge,
  mergeMap,
  of,
  race,
  repeat,
  scan,
  share,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  takeWhile,
  timer,
} from 'rxjs';
import type { Observable, SchedulerLike } from 'rxjs';
import { MetricAccumulator } from './metric-accumulator';
import { producerErrorCode, ProducerFault } from './producer-error';
import type { GeneratorPort } from './wasm-generator';
import { isProducerWorkerCommand } from './worker.protocol';
import type {
  ProducerWorkerCommand,
  ProducerWorkerEvent,
  StartRunCommand,
} from './worker.protocol';

export interface ControllerDependencies {
  load(url: string, signal: AbortSignal): Promise<GeneratorPort>;
  emit(event: ProducerWorkerEvent): void;
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
  readonly disposed: boolean;
  readonly transition: RunTransition | null;
}

type ActiveInput =
  | { readonly kind: 'mode'; readonly mode: 'running' | 'paused'; readonly initial: boolean }
  | { readonly kind: 'batch'; readonly updates: ReturnType<GeneratorPort['generateBatch']> };

interface ActiveState {
  readonly metrics: MetricAccumulator;
  readonly sequence: number;
  readonly publishedSequence: number;
  readonly lastPublishedAt: number | null;
  readonly events: readonly ProducerWorkerEvent[];
}

interface EmissionState {
  readonly failedRunId: number | null;
  readonly event: ProducerWorkerEvent | null;
}

export class ProducerController {
  private readonly input = new Subject<unknown>();

  constructor(private readonly dependencies: ControllerDependencies) {
    const commands = this.input.pipe(map(decodeCommand), share());
    commands
      .pipe(
        scan(routeCommand, { currentRunId: 0, disposed: false, transition: null } as RouteState),
        takeWhile((state) => !state.disposed, true),
        filter((state) => state.transition !== null),
        map((state) => state.transition!),
        switchMap((transition): Observable<ProducerWorkerEvent> => {
          switch (transition.kind) {
            case 'start':
              return this.run(transition.command, commands);
            case 'protocol-error':
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
          { failedRunId: null, event: null } as EmissionState,
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
          of({
            type: 'run-error',
            runId: command.runId,
            code: producerErrorCode(error, 'generation'),
          } as const),
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
        (input): input is { kind: 'valid'; command: ProducerWorkerCommand } =>
          input.kind === 'valid' &&
          input.command.runId === command.runId &&
          (input.command.type === 'pause' || input.command.type === 'resume'),
      ),
      map((input) => input.command),
      scan(
        (mode, control) =>
          control.type === 'pause' && mode === 'running'
            ? 'paused'
            : control.type === 'resume' && mode === 'paused'
              ? 'running'
              : mode,
        'running' as 'running' | 'paused',
      ),
      startWith('running' as const),
      distinctUntilChanged(),
      map((mode, index): ActiveInput => ({ kind: 'mode', mode, initial: index === 0 })),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    const batches = modes.pipe(
      switchMap((input) => {
        if (input.kind !== 'mode' || input.mode === 'paused') return EMPTY;
        const batch = defer(() =>
          of(generator.generateBatch(command.settings.updatesPerBatch)),
        ).pipe(repeat({ delay: () => timer(intervalMs, scheduler) }));
        return input.initial ? batch : timer(intervalMs, scheduler).pipe(switchMap(() => batch));
      }),
      map((updates): ActiveInput => ({ kind: 'batch', updates })),
    );

    const initial: ActiveState = {
      metrics: new MetricAccumulator(command.settings.instrumentCount),
      sequence: 0,
      publishedSequence: 0,
      lastPublishedAt: null,
      events: [],
    };
    return merge(modes, batches).pipe(
      scan(
        (state, input) =>
          reduceActive(
            state,
            input,
            command.runId,
            command.settings.updatesPerBatch,
            this.dependencies,
          ),
        initial,
      ),
      mergeMap((state) => from(state.events)),
      catchError((error: unknown) =>
        of({
          type: 'run-error',
          runId: command.runId,
          code: producerErrorCode(error, 'generation'),
        } as const),
      ),
    );
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
    if (input.runId === null || input.runId < state.currentRunId) {
      return { ...state, transition: null };
    }
    return {
      currentRunId: input.runId,
      disposed: false,
      transition: { kind: 'protocol-error', runId: input.runId },
    };
  }

  const command = input.command;
  if (command.type === 'start-run' && command.runId > state.currentRunId) {
    return {
      currentRunId: command.runId,
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
  dependencies: ControllerDependencies,
): ActiveState {
  if (input.kind === 'mode') {
    if (input.mode === 'running') {
      return {
        ...state,
        events: [{ type: 'status-changed', runId, status: 'running' }],
      };
    }
    const snapshot =
      state.sequence > state.publishedSequence ? [makeSnapshot(state, runId, dependencies)] : [];
    return {
      ...state,
      publishedSequence: state.sequence,
      lastPublishedAt: snapshot.length > 0 ? dependencies.now() : state.lastPublishedAt,
      events: [...snapshot, { type: 'status-changed', runId, status: 'paused' }],
    };
  }

  if (input.updates.length !== batchSize) throw new ProducerFault('protocol');
  state.metrics.applyBatch(input.updates);
  const sequence = state.sequence + 1;
  const now = dependencies.now();
  const publish = state.lastPublishedAt === null || now - state.lastPublishedAt >= 100;
  const next = { ...state, sequence };
  return {
    ...next,
    publishedSequence: publish ? sequence : state.publishedSequence,
    lastPublishedAt: publish ? now : state.lastPublishedAt,
    events: publish ? [makeSnapshot(next, runId, dependencies)] : [],
  };
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
    metrics: state.metrics.serializedSnapshot(),
  };
}
