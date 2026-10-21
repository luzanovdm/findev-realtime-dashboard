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

describe('producer error catalogue', () => {
  const codes = Object.values(ProducerErrorCode);

  it.each(codes)('provides a safe fixed description for %s', (code) => {
    const error = describeProducerError(code);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(10);
    expect(error.message).not.toMatch(/https?:|\/Users\/|Error:/);
    expect(Object.values(ProducerErrorSeverity)).toContain(error.severity);
    expect(Object.values(ProducerDataDisposition)).toContain(error.dataDisposition);
    expect(Object.values(ProducerRecoveryAction)).toContain(error.recoveryAction);
  });

  it.each([
    [
      ProducerErrorCode.WorkerUnavailable,
      ProducerErrorSeverity.Environment,
      ProducerDataDisposition.Hide,
      ProducerRecoveryAction.None,
    ],
    [
      ProducerErrorCode.WasmFetch,
      ProducerErrorSeverity.RunError,
      ProducerDataDisposition.Stale,
      ProducerRecoveryAction.StartNewRun,
    ],
    [
      ProducerErrorCode.Protocol,
      ProducerErrorSeverity.IntegrityCritical,
      ProducerDataDisposition.Hide,
      ProducerRecoveryAction.StartNewRun,
    ],
  ])(
    'applies the required recovery policy for %s',
    (code, severity, dataDisposition, recoveryAction) => {
      expect(describeProducerError(code)).toMatchObject({
        severity,
        dataDisposition,
        recoveryAction,
      });
    },
  );

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
