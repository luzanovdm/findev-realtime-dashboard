import {
  describeProducerError,
  isProducerErrorCode,
  producerErrorCode,
  ProducerFault,
} from './producer-error';
import type { ProducerErrorCode } from './market-producer.types';

describe('producer error catalogue', () => {
  const codes: ProducerErrorCode[] = [
    'worker-unavailable',
    'wasm-fetch',
    'wasm-instantiate',
    'worker-crash',
    'worker-timeout',
    'generation',
    'wasm-abi',
    'protocol',
    'invalid-update',
    'metric-failure',
  ];

  it.each(codes)('provides a safe fixed description for %s', (code) => {
    const error = describeProducerError(code);
    expect(error.code).toBe(code);
    expect(error.message.length).toBeGreaterThan(10);
    expect(error.message).not.toMatch(/https?:|\/Users\/|Error:/);
    expect(['environment', 'run-error', 'integrity-critical']).toContain(error.severity);
    expect(['hide', 'stale']).toContain(error.dataDisposition);
    expect(['none', 'start-new-run']).toContain(error.recoveryAction);
  });

  it('rejects unknown and inherited codes without exposing raw causes', () => {
    expect(isProducerErrorCode('toString')).toBe(false);
    expect(isProducerErrorCode('not-in-catalogue')).toBe(false);
    expect(producerErrorCode(new Error('secret path'), 'protocol')).toBe('protocol');
    expect(producerErrorCode(new ProducerFault('wasm-fetch', 'secret path'), 'protocol')).toBe(
      'wasm-fetch',
    );
  });
});
