import { financialDecimal } from './financial-decimal';
import type { MarketUpdate } from './market-producer.types';
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

function harness(generator?: GeneratorPort) {
  const events: ProducerWorkerEvent[] = [];
  const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimer = 0;
  let now = 0;
  const activeGenerator: GeneratorPort = generator ?? {
    initialize: vi.fn(),
    generateBatch: vi.fn(() => [update()]),
  };
  const load = vi.fn().mockResolvedValue(activeGenerator);
  const controller = new ProducerController({
    load,
    emit: (event) => events.push(event),
    schedule: (callback, delayMs) => {
      const handle = ++nextTimer;
      scheduled.set(handle, { callback, delayMs });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (handle) => {
      scheduled.delete(handle as unknown as number);
    },
    now: () => now,
    timestampMs: () => 1000 + now,
  });
  const fireNext = (): (() => void) => {
    const [handle, task] = scheduled.entries().next().value as [
      number,
      { callback: () => void; delayMs: number },
    ];
    scheduled.delete(handle);
    now += task.delayMs;
    task.callback();
    return task.callback;
  };
  return { controller, events, scheduled, load, generator: activeGenerator, fireNext };
}

async function startDefault(controller: ProducerController): Promise<void> {
  controller.dispatch(start(1));
  await Promise.resolve();
}

describe('ProducerController', () => {
  it('starts one immediate batch and schedules exactly one future batch', async () => {
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
    expect(h.scheduled.size).toBe(1);
    expect([...h.scheduled.values()][0].delayMs).toBe(50);
  });

  it('pauses without catch-up, then resumes after a full interval with totals intact', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    h.controller.dispatch({ type: 'pause', runId: 1 });
    expect(h.scheduled.size).toBe(0);
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);

    h.controller.dispatch({ type: 'resume', runId: 1 });
    h.controller.dispatch({ type: 'resume', runId: 1 });
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(1);
    expect(h.scheduled.size).toBe(1);
    h.fireNext();
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(2);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    const snapshots = h.events.filter((event) => event.type === 'snapshot');
    expect(snapshots.at(-1)?.metrics[0].volume).toBe(2n);
  });

  it('coalesces presentation snapshots without losing trades', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.fireNext();
    expect(h.events.filter((event) => event.type === 'snapshot')).toHaveLength(1);
    h.fireNext();
    const snapshots = h.events.filter((event) => event.type === 'snapshot');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].sequence).toBe(3);
    expect(snapshots[1].metrics[0].volume).toBe(3n);
  });

  it('discards old scheduled callbacks and applies new settings as a reset', async () => {
    const h = harness();
    await startDefault(h.controller);
    const oldCallback = [...h.scheduled.values()][0].callback;
    h.controller.dispatch(start(2));
    await Promise.resolve();
    oldCallback();
    expect(h.generator.generateBatch).toHaveBeenCalledTimes(2);
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
    h.fireNext();
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'invalid-update' },
    ]);
    expect(h.scheduled.size).toBe(0);
    h.controller.dispatch({ type: 'pause', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toHaveLength(1);
  });

  it('rejects malformed current-run commands and disposes idempotently', async () => {
    const h = harness();
    await startDefault(h.controller);
    h.controller.dispatch({ type: 'unknown', runId: 1 });
    expect(h.events.filter((event) => event.type === 'run-error')).toEqual([
      { type: 'run-error', runId: 1, code: 'protocol' },
    ]);
    h.controller.dispatch({ type: 'dispose', runId: 1 });
    h.controller.dispatch({ type: 'dispose', runId: 1 });
    expect(h.scheduled.size).toBe(0);
  });
});
