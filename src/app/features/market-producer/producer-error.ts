import type { ProducerError, ProducerErrorCode } from './market-producer.types';

const ERROR_CATALOGUE = {
  'worker-unavailable': {
    severity: 'environment',
    dataDisposition: 'hide',
    recoveryAction: 'none',
    message: 'This browser cannot run the market producer.',
  },
  'wasm-fetch': {
    severity: 'run-error',
    dataDisposition: 'stale',
    recoveryAction: 'start-new-run',
    message: 'Market data could not be loaded. Start a new run to try again.',
  },
  'wasm-instantiate': {
    severity: 'run-error',
    dataDisposition: 'stale',
    recoveryAction: 'start-new-run',
    message: 'The market generator could not start. Start a new run to try again.',
  },
  'worker-crash': {
    severity: 'run-error',
    dataDisposition: 'stale',
    recoveryAction: 'start-new-run',
    message: 'Market data stopped unexpectedly. Displayed values are outdated. Start a new run.',
  },
  'worker-timeout': {
    severity: 'run-error',
    dataDisposition: 'stale',
    recoveryAction: 'start-new-run',
    message: 'The market producer stopped responding. Start a new run.',
  },
  generation: {
    severity: 'run-error',
    dataDisposition: 'stale',
    recoveryAction: 'start-new-run',
    message: 'Market data generation stopped. Start a new run.',
  },
  'wasm-abi': {
    severity: 'integrity-critical',
    dataDisposition: 'hide',
    recoveryAction: 'start-new-run',
    message: 'The market generator is incompatible. Values are unavailable.',
  },
  protocol: {
    severity: 'integrity-critical',
    dataDisposition: 'hide',
    recoveryAction: 'start-new-run',
    message: 'Market data failed validation. Values are unavailable. Start a new run.',
  },
  'invalid-update': {
    severity: 'integrity-critical',
    dataDisposition: 'hide',
    recoveryAction: 'start-new-run',
    message: 'Market data failed validation. Values are unavailable. Start a new run.',
  },
  'metric-failure': {
    severity: 'integrity-critical',
    dataDisposition: 'hide',
    recoveryAction: 'start-new-run',
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
