import { VirtualTimeScheduler } from 'rxjs';
import { financialDecimal } from '../../../core/money/financial-decimal';
import type { MarketUpdate } from '../market-producer.types';
import { ProducerController } from './producer-controller';
import type { ProducerWorkerEvent } from './worker.protocol';
import type { GeneratorPort } from './wasm-generator';

const settings = { instrumentCount: 1, updatesPerBatch: 1, batchIntervalMs: 50 } as const;
const start = (runId: number) => ({
  type: 'start-run',
  runId,
  settings,
  seed: 1,
  wasmUrl: '/wasm/market-generator.wasm',
});

function update(priceCents = '100'): MarketUpdate {
  return {
    instrumentIndex: 0,
    priceCents: financialDecimal(priceCents),
    tradeQuantity: 1n,
    bidCents: financialDecimal('100'),
    askCents: financialDecimal('101'),
    bidQuantity: 1n,
    askQuantity: 1n,
  };
}

function harness(generator?: GeneratorPort, now?: (scheduler: VirtualTimeScheduler) => number) {
  const events: ProducerWorkerEvent[] = [];
  const scheduler = new VirtualTimeScheduler();
  const activeGenerator: GeneratorPort = generator ?? {
    initialize: vi.fn(),
    generateBatch: vi.fn(() => [update()]),
  };
  const load = vi.fn().mockResolvedValue(activeGenerator);
  const reportFailure = vi.fn();
  const controller = new ProducerController({
    load,
    emit: (event) => events.push(event),
    reportFailure,
    scheduler,
    now: () => now?.(scheduler) ?? scheduler.now(),
    timestampMs: () => 1000 + scheduler.now(),
  });
  const advanceBy = (durationMs: number): void => {
    const target = scheduler.frame + durationMs;
    scheduler.maxFrames = target;
    scheduler.flush();
    scheduler.frame = target;
  };
  return { controller, events, load, reportFailure, generator: activeGenerator, advanceBy };
}

async function startDefault(controller: ProducerController): Promise<void> {
  controller.dispatch(start(1));
  await Promise.resolve();
}

describe('ProducerController', () => {
  it('starts one immediate batch and schedules future batches at the requested interval', async () => {
    const h = harness();
    await startDefault(h.controller);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.generator.initialize).toHaveBeenCalledWith(1, 1);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    expect(h.events.map((event) => event.type)).toEqual([
      'status-changed',
      'run-started',
      'status-changed',
      'snapshot',
    ]);
    h.advanceBy(49);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    h.advanceBy(1);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(2);
  });

  it('pauses without catch-up, then resumes after a full interval with totals intact', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    h.controller.dispatch({ type: 'pause', runId: 1 });
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    h.advanceBy(200);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);

    h.controller.dispatch({ type: 'resume', runId: 1 });
    h.controller.dispatch({ type: 'resume', runId: 1 });
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    h.advanceBy(49);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    h.advanceBy(1);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(2);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    const snapshots = h.events.filter((event) => event.type === 'snapshot');
    expect(snapshots.at(-1)?.metrics[0].volume).toBe(2n);
  });

  it('coalesces presentation snapshots without losing trades', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.advanceBy(50);
    expect(h.events.filter((event) => event.type === 'snapshot')).toHaveLength(1);
    h.advanceBy(50);
    const snapshots = h.events.filter((event) => event.type === 'snapshot');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].sequence).toBe(3);
    expect(snapshots[1].metrics[0].volume).toBe(3n);
  });

  it('warns only after sustained slow batches and clears after recovery', async () => {
    let processingTime = 0;
    let delayed = true;
    const generator: GeneratorPort = {
      initialize: vi.fn(),
      generateBatch: vi.fn(() => {
        if (delayed) processingTime += 100;
        return [update()];
      }),
    };
    const h = harness(generator, (scheduler) => scheduler.now() + processingTime);
    await startDefault(h.controller);
    h.advanceBy(250);
    expect(h.events.filter((event) => event.type === 'pace-changed')).toEqual([
      { type: 'pace-changed', runId: 1, slow: true },
    ]);

    delayed = false;
    h.advanceBy(250);
    expect(h.events.filter((event) => event.type === 'pace-changed')).toEqual([
      { type: 'pace-changed', runId: 1, slow: true },
      { type: 'pace-changed', runId: 1, slow: false },
    ]);
  });

  it('cancels old generation when Apply starts a new run', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.controller.dispatch(start(2));
    await Promise.resolve();
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(2);
    h.advanceBy(50);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(3);
    const snapshots = h.events.filter((event) => event.type === 'snapshot');
    expect(snapshots.map((event) => event.runId)).toEqual([1, 2]);
    expect(snapshots[1].metrics[0].volume).toBe(1n);
  });

  it('ignores late initialization from a replaced run', async () => {
    const h = harness();
    const resolvers: ((generator: GeneratorPort) => void)[] = [];
    h.load.mockImplementation(
      () => new Promise<GeneratorPort>((resolve) => resolvers.push(resolve)),
    );
    h.controller.dispatch(start(1));
    h.controller.dispatch(start(2));
    resolvers[0](h.generator);
    await Promise.resolve();
    expect(h.events.some((event) => event.type === 'run-started' && event.runId === 1)).toBe(false);
    resolvers[1](h.generator);
    await Promise.resolve();
    expect(h.events.some((event) => event.type === 'run-started' && event.runId === 2)).toBe(true);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a control during initialization and aborts the pending load', () => {
    const h = harness();
    h.load.mockImplementation(() => new Promise<GeneratorPort>(() => {}));
    h.controller.dispatch(start(1));
    const signal = h.load.mock.calls[0][1];
    h.controller.dispatch({ type: 'pause', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'protocol' },
    ]);
    expect(signal.aborted).toBe(true);
  });

  it('rejects an undersized generated batch and reports one error per run', async () => {
    const h = harness({
      initialize: vi.fn(),
      generateBatch: vi.fn(() => []),
    });
    await startDefault(h.controller);
    h.controller.dispatch({ type: 'unknown', runId: 1 });
    h.controller.dispatch({ type: 'unknown', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'protocol' },
    ]);
    h.advanceBy(200);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
  });

  it('publishes one typed failure and cancels future work after a bad batch', async () => {
    const generator: GeneratorPort = {
      initialize: vi.fn(),
      generateBatch: vi
        .fn()
        .mockReturnValueOnce([update()])
        .mockReturnValueOnce([update('99')]),
    };
    const h = harness(generator);
    await startDefault(h.controller);
    h.advanceBy(50);
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'invalid-update' },
    ]);
    expect(h.reportFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: 'invalid-update', runId: 1, stage: 'generation' }),
    );
    h.advanceBy(200);
    expect(generator.generateBatch).toHaveBeenCalledTimes(2);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toHaveLength(1);
  });

  it('rejects malformed current-run commands and disposes idempotently', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.controller.dispatch({ type: 'unknown', runId: 1 });
    h.controller.dispatch({ type: 'unknown', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'protocol' },
    ]);
    expect(h.reportFailure).toHaveBeenCalledTimes(1);
    h.controller.dispatch({ type: 'dispose', runId: 1 });
    h.controller.dispatch({ type: 'dispose', runId: 1 });
    h.advanceBy(200);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
  });
});
