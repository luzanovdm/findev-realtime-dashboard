import {
  ProducerDataDisposition,
  ProducerErrorCode,
  ProducerErrorSeverity,
  ProducerRecoveryAction,
} from './market-producer.types';
import type { ProducerError } from './market-producer.types';

const ERROR_POLICIES = {
  environment: {
    severity: ProducerErrorSeverity.Environment,
    dataDisposition: ProducerDataDisposition.Hide,
    recoveryAction: ProducerRecoveryAction.None,
  },
  recoverable: {
    severity: ProducerErrorSeverity.RunError,
    dataDisposition: ProducerDataDisposition.Stale,
    recoveryAction: ProducerRecoveryAction.StartNewRun,
  },
  integrity: {
    severity: ProducerErrorSeverity.IntegrityCritical,
    dataDisposition: ProducerDataDisposition.Hide,
    recoveryAction: ProducerRecoveryAction.StartNewRun,
  },
} as const satisfies Readonly<Record<string, Omit<ProducerError, 'code' | 'message'>>>;

const ERROR_CATALOGUE = {
  [ProducerErrorCode.WorkerUnavailable]: {
    ...ERROR_POLICIES.environment,
    message: 'This browser cannot run the market producer.',
  },
  [ProducerErrorCode.WasmFetch]: {
    ...ERROR_POLICIES.recoverable,
    message: 'Market data could not be loaded. Start a new run to try again.',
  },
  [ProducerErrorCode.WasmInstantiate]: {
    ...ERROR_POLICIES.recoverable,
    message: 'The market generator could not start. Start a new run to try again.',
  },
  [ProducerErrorCode.WorkerCrash]: {
    ...ERROR_POLICIES.recoverable,
    message: 'Market data stopped unexpectedly. Displayed values are outdated. Start a new run.',
  },
  [ProducerErrorCode.WorkerTimeout]: {
    ...ERROR_POLICIES.recoverable,
    message: 'The market producer stopped responding. Start a new run.',
  },
  [ProducerErrorCode.Generation]: {
    ...ERROR_POLICIES.recoverable,
    message: 'Market data generation stopped. Start a new run.',
  },
  [ProducerErrorCode.WasmAbi]: {
    ...ERROR_POLICIES.integrity,
    message: 'The market generator is incompatible. Values are unavailable.',
  },
  [ProducerErrorCode.Protocol]: {
    ...ERROR_POLICIES.integrity,
    message: 'Market data failed validation. Values are unavailable. Start a new run.',
  },
  [ProducerErrorCode.InvalidUpdate]: {
    ...ERROR_POLICIES.integrity,
    message: 'Market data failed validation. Values are unavailable. Start a new run.',
  },
  [ProducerErrorCode.MetricFailure]: {
    ...ERROR_POLICIES.integrity,
    message: 'Market metrics could not be verified. Values are unavailable. Start a new run.',
  },
} as const satisfies Readonly<Record<ProducerErrorCode, Omit<ProducerError, 'code'>>>;

export class ProducerFault extends Error {
  constructor(
    readonly code: ProducerErrorCode,
    cause?: unknown,
  ) {
    super(ERROR_CATALOGUE[code].message, { cause });
    this.name = 'ProducerFault';
  }
}

export function describeProducerError(code: ProducerErrorCode): ProducerError {
  return { code, ...ERROR_CATALOGUE[code] };
}

export function producerErrorCode(
  error: unknown,
  fallbackCode: ProducerErrorCode,
): ProducerErrorCode {
  return error instanceof ProducerFault ? error.code : fallbackCode;
}

export function isProducerErrorCode(value: unknown): value is ProducerErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOGUE, value);
}
