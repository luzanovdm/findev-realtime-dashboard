import { TestBed } from '@angular/core/testing';
import { MarketProducerFacade } from './market-producer.facade';
import { DEFAULT_PRODUCER_SETTINGS } from './producer-settings';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruct = false;
  static failPost = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly commands: unknown[] = [];
  readonly terminate = vi.fn();

  constructor() {
    if (FakeWorker.failConstruct) throw new Error('private constructor failure');
    FakeWorker.instances.push(this);
  }

  postMessage(command: unknown): void {
    if (FakeWorker.failPost) throw new Error('private post failure');
    this.commands.push(command);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function acknowledgedRun(
  worker: FakeWorker,
  runId = 1,
  settings = DEFAULT_PRODUCER_SETTINGS,
): void {
  worker.emit({ type: 'status-changed', runId, status: 'initializing' });
  worker.emit({ type: 'run-started', runId, activeSettings: settings });
  worker.emit({ type: 'status-changed', runId, status: 'running' });
}

function snapshot(runId = 1, count = 5) {
  return {
    type: 'snapshot',
    runId,
    sequence: 1,
    timestampMs: 1000,
    metrics: Array.from({ length: count }, (_, index) => ({
      instrument: `ASSET-${String(index + 1).padStart(2, '0')}`,
      lastPriceCents: index === 0 ? '10200' : null,
      spreadCents: index === 0 ? '4' : null,
      volume: index === 0 ? 30n : 0n,
      vwapCents: index === 0 ? '10200' : null,
      imbalance: index === 0 ? '0.2' : null,
    })),
  };
}

describe('MarketProducerFacade', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.failConstruct = false;
    FakeWorker.failPost = false;
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('crypto', {
      getRandomValues: (values: Uint32Array) => {
        values[0] = 123;
        return values;
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts defaults once and exposes validated Decimal snapshot values', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    facade.start();
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.commands).toHaveLength(1);
    expect(worker.commands[0]).toMatchObject({
      type: 'start-run',
      runId: 1,
      settings: DEFAULT_PRODUCER_SETTINGS,
      seed: 123,
    });
    acknowledgedRun(worker);
    worker.emit(snapshot());
    expect(facade.status()).toBe('running');
    expect(facade.metrics()[0].lastPriceCents?.toFixed()).toBe('10200');
    expect(facade.metrics()[0].volume).toBe(30n);
    expect(facade.snapshotAt()).toBe(1000);
  });

  it('guards Pause and Resume commands and keeps the same worker', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    facade.pause();
    facade.pause();
    expect(
      worker.commands.filter((item) => (item as { type: string }).type === 'pause'),
    ).toHaveLength(1);
    worker.emit({ type: 'status-changed', runId: 1, status: 'paused' });
    facade.resume();
    facade.resume();
    expect(
      worker.commands.filter((item) => (item as { type: string }).type === 'resume'),
    ).toHaveLength(1);
    worker.emit({ type: 'status-changed', runId: 1, status: 'running' });
    expect(facade.status()).toBe('running');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('keeps a slow-delivery warning separate from producer status and resets it on Apply', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit({ type: 'pace-changed', runId: 1, slow: true });
    expect(facade.status()).toBe('running');
    expect(facade.slow()).toBe(true);
    facade.pause();
    worker.emit({ type: 'status-changed', runId: 1, status: 'paused' });
    expect(facade.slow()).toBe(false);
    facade.apply(DEFAULT_PRODUCER_SETTINGS);
    expect(facade.slow()).toBe(false);
  });

  it('clears rows on Apply and ignores old-run replies', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    const nextSettings = { instrumentCount: 2, updatesPerBatch: 1, batchIntervalMs: 50 };
    expect(facade.apply(nextSettings)).toBe(true);
    expect(facade.runId()).toBe(2);
    expect(facade.metrics()).toHaveLength(2);
    expect(facade.metrics()[0].volume).toBe(0n);
    const outcomes: string[] = [];
    facade.outcomeOf(2).subscribe((outcome) => outcomes.push(outcome));
    worker.emit(snapshot(1));
    expect(facade.status()).toBe('initializing');
    acknowledgedRun(worker, 2, nextSettings);
    worker.emit(snapshot(2, 2));
    expect(facade.metrics()[0].volume).toBe(30n);
    expect(outcomes).toEqual(['running']);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('retains a confirmed stale snapshot on crash and constructs a fresh worker for recovery', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    worker.onerror?.();
    expect(facade.status()).toBe('error');
    expect(facade.error()?.code).toBe('worker-crash');
    expect(facade.stale()).toBe(true);
    expect(facade.metrics()[0].volume).toBe(30n);
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    expect(facade.apply(DEFAULT_PRODUCER_SETTINGS)).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(facade.metrics()[0].volume).toBe(0n);
  });

  it('reports a failed new run to its awaiting form without accepting stale data', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    facade.apply(DEFAULT_PRODUCER_SETTINGS);
    const outcomes: string[] = [];
    facade.outcomeOf(2).subscribe((outcome) => outcomes.push(outcome));
    worker.emit({ type: 'run-error', runId: 2, code: 'wasm-fetch' });
    expect(outcomes).toEqual(['error']);
    expect(facade.metrics()[0].volume).toBe(0n);
  });

  it('hides values after a malformed current-run snapshot', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    worker.emit({
      ...snapshot(),
      sequence: 2,
      metrics: [{ ...snapshot().metrics[0], volume: -1n }],
    });
    expect(facade.error()?.code).toBe('protocol');
    expect(facade.metrics()[0].lastPriceCents).toBeNull();
    expect(facade.stale()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects a snapshot whose cumulative volume regresses', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    worker.emit({
      ...snapshot(),
      sequence: 2,
      metrics: snapshot().metrics.map((metric, index) =>
        index === 0 ? { ...metric, volume: 29n } : metric,
      ),
    });

    expect(facade.error()?.code).toBe('protocol');
    expect(facade.metrics()[0].volume).toBe(0n);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects a higher-sequence snapshot with no new trades', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    worker.emit({ ...snapshot(), sequence: 2 });

    expect(facade.error()?.code).toBe('protocol');
    expect(facade.metrics()[0].volume).toBe(0n);
  });

  it('terminates a worker that never acknowledges initialization', () => {
    vi.useFakeTimers();
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    vi.advanceTimersByTime(5000);
    expect(facade.error()?.code).toBe('worker-timeout');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('times out a missing Pause acknowledgement and terminates the worker', () => {
    vi.useFakeTimers();
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    facade.pause();
    vi.advanceTimersByTime(2000);
    expect(facade.error()?.code).toBe('worker-timeout');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not interpret hidden-tab timer throttling as worker failure', () => {
    vi.useFakeTimers();
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    try {
      const facade = TestBed.inject(MarketProducerFacade);
      facade.start();
      const worker = FakeWorker.instances[0];
      acknowledgedRun(worker);
      worker.emit(snapshot());

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(10_000);
      expect(facade.status()).toBe('running');

      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(5_000);
      expect(facade.error()?.code).toBe('worker-timeout');
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('contains a synchronous postMessage failure', () => {
    FakeWorker.failPost = true;
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    expect(facade.error()?.code).toBe('worker-crash');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('contains a synchronous worker construction failure', () => {
    FakeWorker.failConstruct = true;
    const facade = TestBed.inject(MarketProducerFacade);
    expect(() => facade.start()).not.toThrow();
    expect(facade.error()?.code).toBe('worker-unavailable');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('hides previously confirmed values after a worker message decode failure', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    worker.emit(snapshot());
    worker.onmessageerror?.();
    expect(facade.error()?.code).toBe('protocol');
    expect(facade.metrics()[0].volume).toBe(0n);
    expect(facade.stale()).toBe(false);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('ignores a late error from the replaced run', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    acknowledgedRun(worker);
    expect(facade.apply({ instrumentCount: 2, updatesPerBatch: 1, batchIntervalMs: 50 })).toBe(
      true,
    );
    worker.emit({ type: 'run-error', runId: 1, code: 'generation' });
    expect(facade.status()).toBe('initializing');
    expect(facade.error()).toBeNull();
  });

  it('detaches and terminates the worker once when the application is destroyed', () => {
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    const worker = FakeWorker.instances[0];
    TestBed.resetTestingModule();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it('reports unsupported Worker without leaving initialization pending', () => {
    vi.stubGlobal('Worker', undefined);
    const facade = TestBed.inject(MarketProducerFacade);
    facade.start();
    expect(facade.status()).toBe('error');
    expect(facade.error()?.code).toBe('worker-unavailable');
    expect(facade.apply(DEFAULT_PRODUCER_SETTINGS)).toBe(false);
  });
});
