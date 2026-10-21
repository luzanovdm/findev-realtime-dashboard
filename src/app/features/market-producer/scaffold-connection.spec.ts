import { TestBed } from '@angular/core/testing';
import { ScaffoldConnection } from './scaffold-connection';

class FakeWorker {
  static latest: FakeWorker;
  static failPost = false;

  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.latest = this;
  }

  postMessage(): void {
    if (FakeWorker.failPost) throw new Error('private message failure');
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

describe('scaffold worker connection', () => {
  beforeEach(() => {
    FakeWorker.failPost = false;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects missing worker support without constructing a worker', async () => {
    vi.stubGlobal('Worker', undefined);
    await expect(TestBed.inject(ScaffoldConnection).check()).rejects.toMatchObject({
      code: 'worker-unavailable',
    });
  });

  it('contains a worker constructor failure', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('private constructor failure');
        }
      },
    );
    await expect(TestBed.inject(ScaffoldConnection).check()).rejects.toMatchObject({
      code: 'worker-unavailable',
    });
  });

  it('classifies malformed replies and ignores later events', async () => {
    const result = TestBed.inject(ScaffoldConnection).check();
    const worker = FakeWorker.latest;
    worker.emit({ type: 'smoke-error', code: 'unknown', message: 'private text' });
    await expect(result).rejects.toMatchObject({ code: 'protocol' });
    worker.emit({ type: 'smoke-ok', value: 42 });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates an unresponsive worker at the deadline', async () => {
    vi.useFakeTimers();
    const result = TestBed.inject(ScaffoldConnection).check();
    const rejection = expect(result).rejects.toMatchObject({ code: 'worker-timeout' });
    const worker = FakeWorker.latest;
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('contains postMessage failure and worker crash', async () => {
    FakeWorker.failPost = true;
    await expect(TestBed.inject(ScaffoldConnection).check()).rejects.toMatchObject({
      code: 'worker-crash',
    });
    expect(FakeWorker.latest.terminate).toHaveBeenCalledTimes(1);

    FakeWorker.failPost = false;
    const result = TestBed.inject(ScaffoldConnection).check();
    const worker = FakeWorker.latest;
    worker.onerror?.();
    await expect(result).rejects.toMatchObject({ code: 'worker-crash' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('contains a message deserialization failure', async () => {
    const result = TestBed.inject(ScaffoldConnection).check();
    const worker = FakeWorker.latest;
    worker.onmessageerror?.();
    await expect(result).rejects.toMatchObject({ code: 'protocol' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
