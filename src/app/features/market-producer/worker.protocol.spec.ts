import { DEFAULT_PRODUCER_SETTINGS } from './producer-settings';
import { isProducerWorkerCommand, isProducerWorkerEvent } from './worker.protocol';

describe('producer worker protocol', () => {
  const validStart = {
    type: 'start-run',
    runId: 1,
    settings: DEFAULT_PRODUCER_SETTINGS,
    seed: 0xffff_ffff,
    wasmUrl: 'http://localhost/wasm/market-generator.wasm',
  } as const;

  const validMetric = {
    instrument: 'ASSET-01',
    lastPriceCents: '10200',
    spreadCents: '4',
    volume: 40n,
    vwapCents: '10150',
    imbalance: '0.2',
  } as const;

  const validSnapshot = {
    type: 'snapshot',
    runId: 1,
    sequence: 1,
    timestampMs: 100,
    metrics: [validMetric],
  } as const;

  it('accepts every valid command type', () => {
    expect(isProducerWorkerCommand(validStart)).toBe(true);
    expect(isProducerWorkerCommand({ type: 'pause', runId: 1 })).toBe(true);
    expect(isProducerWorkerCommand({ type: 'resume', runId: 1 })).toBe(true);
    expect(isProducerWorkerCommand({ type: 'dispose', runId: 1 })).toBe(true);
  });

  it.each([
    { ...validStart, runId: 0 },
    { ...validStart, seed: 0 },
    { ...validStart, wasmUrl: '   ' },
    { ...validStart, settings: { ...DEFAULT_PRODUCER_SETTINGS, instrumentCount: 51 } },
    { type: 'unknown', runId: 1 },
    null,
  ])('rejects an invalid command: %o', (command) => {
    expect(isProducerWorkerCommand(command)).toBe(false);
  });

  it('accepts every valid event type', () => {
    expect(
      isProducerWorkerEvent({
        type: 'run-started',
        runId: 1,
        activeSettings: DEFAULT_PRODUCER_SETTINGS,
      }),
    ).toBe(true);
    expect(isProducerWorkerEvent(validSnapshot)).toBe(true);
    expect(isProducerWorkerEvent({ type: 'status-changed', runId: 1, status: 'paused' })).toBe(
      true,
    );
    expect(
      isProducerWorkerEvent({
        type: 'run-error',
        runId: 1,
        code: 'generation',
      }),
    ).toBe(true);
    expect(isProducerWorkerEvent({ type: 'pace-changed', runId: 1, slow: true })).toBe(true);
  });

  it.each([
    { ...validSnapshot, sequence: 0 },
    { ...validSnapshot, timestampMs: -1 },
    { ...validSnapshot, metrics: [{ ...validMetric, volume: -1n }] },
    { ...validSnapshot, metrics: [{ ...validMetric, imbalance: '1.1' }] },
    { ...validSnapshot, metrics: [{ ...validMetric, spreadCents: '-1' }] },
    { ...validSnapshot, metrics: [{ ...validMetric, spreadCents: '0' }] },
    { ...validSnapshot, metrics: [{ ...validMetric, vwapCents: '1e3' }] },
    { ...validSnapshot, metrics: [{ ...validMetric, instrument: 'ASSET-51' }] },
    { ...validSnapshot, metrics: [validMetric, validMetric] },
    { type: 'status-changed', runId: 1, status: 'stopped' },
    { type: 'run-error', runId: 1, code: 'unknown' },
    { type: 'run-error', runId: 1, error: { code: 'generation', message: '' } },
    { type: 'pace-changed', runId: 1, slow: 'yes' },
    { ...validSnapshot, runId: 0 },
  ])('rejects an invalid event: %o', (event) => {
    expect(isProducerWorkerEvent(event)).toBe(false);
  });

  it('preserves bigint metrics through structured cloning', () => {
    const event = structuredClone(validSnapshot);

    expect(event.metrics[0]?.volume).toBe(40n);
    expect(isProducerWorkerEvent(event)).toBe(true);
  });
});
