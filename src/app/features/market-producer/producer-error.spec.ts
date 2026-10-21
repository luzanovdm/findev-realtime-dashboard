import {
  describeProducerError,
  isProducerErrorCode,
  producerErrorCode,
  ProducerFault,
} from './producer-error';
import {
  ProducerDataDisposition,
  ProducerErrorCode,
  ProducerErrorSeverity,
  ProducerRecoveryAction,
} from './market-producer.types';
import type { ProducerError } from './market-producer.types';

describe('producer error catalogue', () => {
  const codes = Object.values(ProducerErrorCode);
  const environment = {
    severity: ProducerErrorSeverity.Environment,
    dataDisposition: ProducerDataDisposition.Hide,
    recoveryAction: ProducerRecoveryAction.None,
  };
  const recoverable = {
    severity: ProducerErrorSeverity.RunError,
    dataDisposition: ProducerDataDisposition.Stale,
    recoveryAction: ProducerRecoveryAction.StartNewRun,
  };
  const integrity = {
    severity: ProducerErrorSeverity.IntegrityCritical,
    dataDisposition: ProducerDataDisposition.Hide,
    recoveryAction: ProducerRecoveryAction.StartNewRun,
  };
  const expectedPolicies = {
    [ProducerErrorCode.WorkerUnavailable]: environment,
    [ProducerErrorCode.WasmFetch]: recoverable,
    [ProducerErrorCode.WasmInstantiate]: recoverable,
    [ProducerErrorCode.WorkerCrash]: recoverable,
    [ProducerErrorCode.WorkerTimeout]: recoverable,
    [ProducerErrorCode.Generation]: recoverable,
    [ProducerErrorCode.WasmAbi]: integrity,
    [ProducerErrorCode.Protocol]: integrity,
    [ProducerErrorCode.InvalidUpdate]: integrity,
    [ProducerErrorCode.MetricFailure]: integrity,
  } satisfies Readonly<Record<ProducerErrorCode, Omit<ProducerError, 'code' | 'message'>>>;

  it.each(codes)('provides a safe fixed description for %s', (code) => {
    const error = describeProducerError(code);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(10);
    expect(error.message).not.toMatch(/https?:|\/Users\/|Error:/);
    expect(Object.values(ProducerErrorSeverity)).toContain(error.severity);
    expect(Object.values(ProducerDataDisposition)).toContain(error.dataDisposition);
    expect(Object.values(ProducerRecoveryAction)).toContain(error.recoveryAction);
  });

  it.each(codes)('applies the required recovery policy for %s', (code) => {
    expect(describeProducerError(code)).toMatchObject(expectedPolicies[code]);
  });

  it('rejects unknown and inherited codes without exposing raw causes', () => {
    expect(isProducerErrorCode('toString')).toBe(false);
    expect(isProducerErrorCode('not-in-catalogue')).toBe(false);
    expect(producerErrorCode(new Error('secret path'), ProducerErrorCode.Protocol)).toBe(
      ProducerErrorCode.Protocol,
    );
    expect(
      producerErrorCode(
        new ProducerFault(ProducerErrorCode.WasmFetch, 'secret path'),
        ProducerErrorCode.Protocol,
      ),
    ).toBe(ProducerErrorCode.WasmFetch);
  });
});
