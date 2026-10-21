import { filter, map } from 'rxjs';
import type { Observable } from 'rxjs';
import { isPositiveSafeInteger } from '../../../core/validation/integer-range';
import { isProducerWorkerCommand } from './worker.protocol';
import type { ProducerWorkerCommand, StartRunCommand } from './worker.protocol';

export type CommandInput =
  | { readonly kind: 'valid'; readonly command: ProducerWorkerCommand }
  | { readonly kind: 'malformed'; readonly runId: number | null };

export type RouteTransition =
  | { readonly kind: 'start'; readonly command: StartRunCommand }
  | { readonly kind: 'protocol-error'; readonly runId: number }
  | { readonly kind: 'dispose' };

export interface RouteState {
  readonly currentRunId: number;
  readonly protocolFailedRunId: number | null;
  readonly disposed: boolean;
  readonly transition: RouteTransition | null;
}

export type RunMode = 'running' | 'paused';
type ControlCommand = Extract<ProducerWorkerCommand, { type: 'pause' | 'resume' }>;

const MODE_FOR_CONTROL = { pause: 'paused', resume: 'running' } as const satisfies Readonly<
  Record<ControlCommand['type'], RunMode>
>;

export const INITIAL_ROUTE_STATE: RouteState = {
  currentRunId: 0,
  protocolFailedRunId: null,
  disposed: false,
  transition: null,
};

export function decodeCommand(value: unknown): CommandInput {
  if (isProducerWorkerCommand(value)) return { kind: 'valid', command: value };
  if (typeof value !== 'object' || value === null || !('runId' in value)) {
    return { kind: 'malformed', runId: null };
  }
  const runId = value.runId;
  return {
    kind: 'malformed',
    runId: isPositiveSafeInteger(runId) ? runId : null,
  };
}

export function controlModesForRun(
  commands: Observable<CommandInput>,
  runId: number,
): Observable<RunMode> {
  return commands.pipe(
    filter((input): input is Extract<CommandInput, { kind: 'valid' }> => input.kind === 'valid'),
    map((input) => input.command),
    filter((command): command is ControlCommand => isRunControl(command, runId)),
    map((command) => MODE_FOR_CONTROL[command.type]),
  );
}

function isRunControl(command: ProducerWorkerCommand, runId: number): command is ControlCommand {
  return command.runId === runId && Object.hasOwn(MODE_FOR_CONTROL, command.type);
}

export function routeCommand(state: RouteState, input: CommandInput): RouteState {
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
