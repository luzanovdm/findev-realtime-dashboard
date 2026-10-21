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
    expect(isProducerWorkerEvent({ type: 'snapshot', runId: 1, metrics: [validMetric] })).toBe(
      true,
    );
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
  });

  it.each([
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, volume: -1n }] },
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, imbalance: '1.1' }] },
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, spreadCents: '-1' }] },
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, spreadCents: '0' }] },
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, vwapCents: '1e3' }] },
    { type: 'snapshot', runId: 1, metrics: [{ ...validMetric, instrument: 'ASSET-51' }] },
    { type: 'snapshot', runId: 1, metrics: [validMetric, validMetric] },
    { type: 'status-changed', runId: 1, status: 'stopped' },
    { type: 'run-error', runId: 1, code: 'unknown' },
    { type: 'run-error', runId: 1, error: { code: 'generation', message: '' } },
    { type: 'snapshot', runId: 0, metrics: [] },
  ])('rejects an invalid event: %o', (event) => {
    expect(isProducerWorkerEvent(event)).toBe(false);
  });

  it('preserves bigint metrics through structured cloning', () => {
    const event = structuredClone({ type: 'snapshot', runId: 1, metrics: [validMetric] });

    expect(event.metrics[0]?.volume).toBe(40n);
    expect(isProducerWorkerEvent(event)).toBe(true);
  });
});
