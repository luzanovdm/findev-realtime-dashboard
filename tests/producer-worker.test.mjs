import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

const output = new URL('../dist/findev-realtime-dashboard/browser/', import.meta.url);
const wasm = await readFile(new URL('wasm/market-generator.wasm', output));

function expectedVolumes(instrumentCount, batchSize, seed) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm));
  const { exports } = instance;
  assert.equal(exports.initialize(instrumentCount, seed), 0);
  const pointer = exports.generateBatch(batchSize);
  const view = new DataView(exports.memory.buffer, pointer, batchSize * 28);
  const volumes = Array.from({ length: instrumentCount }, () => 0n);
  for (let record = 0; record < batchSize; record++) {
    const offset = record * 28;
    const index = view.getInt32(offset, true);
    const quantity = view.getInt32(offset + 8, true);
    volumes[index] += BigInt(quantity);
  }
  return volumes;
}

test(
  'production worker runs, pauses, resumes, resets, and reports missing Wasm',
  { timeout: 10000 },
  async (t) => {
    const workers = (await readdir(output)).filter((name) => /^worker-.*\.js$/.test(name));
    assert.equal(workers.length, 1);
    const server = createServer((request, response) => {
      if (request.url === '/wasm/market-generator.wasm') {
        response.writeHead(200, { 'Content-Type': 'application/wasm' });
        response.end(wasm);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const worker = new Worker(new URL('./web-worker-node-adapter.mjs', import.meta.url), {
      workerData: { entry: new URL(workers[0], output).href },
    });
    t.after(async () => {
      await worker.terminate();
      await new Promise((resolve) => server.close(resolve));
    });

    const messages = [];
    worker.on('message', (message) => messages.push(message));
    async function waitFor(predicate, afterIndex = 0) {
      const existing = messages.slice(afterIndex).find(predicate);
      if (existing) return existing;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.off('message', onMessage);
          reject(new Error('Timed out waiting for a worker event'));
        }, 3000);
        const onMessage = (message) => {
          if (!predicate(message)) return;
          clearTimeout(timer);
          worker.off('message', onMessage);
          resolve(message);
        };
        worker.on('message', onMessage);
      });
    }

    const firstSettings = { instrumentCount: 50, updatesPerBatch: 1000, batchIntervalMs: 2000 };
    worker.postMessage({
      type: 'start-run',
      runId: 1,
      settings: firstSettings,
      seed: 12345,
      wasmUrl: `${origin}/wasm/market-generator.wasm`,
    });
    const first = await waitFor((event) => event.type === 'snapshot' && event.runId === 1);
    assert.equal(first.sequence, 1);
    assert.equal(first.metrics.length, 50);
    assert.deepEqual(
      first.metrics.map((metric) => metric.volume),
      expectedVolumes(50, 1000, 12345),
    );

    worker.postMessage({ type: 'pause', runId: 1 });
    await waitFor(
      (event) => event.type === 'status-changed' && event.runId === 1 && event.status === 'paused',
    );
    const resumeOffset = messages.length;
    worker.postMessage({ type: 'resume', runId: 1 });
    await waitFor(
      (event) => event.type === 'status-changed' && event.runId === 1 && event.status === 'running',
      resumeOffset,
    );

    worker.postMessage({
      type: 'start-run',
      runId: 2,
      settings: { instrumentCount: 2, updatesPerBatch: 1, batchIntervalMs: 2000 },
      seed: 54321,
      wasmUrl: `${origin}/wasm/market-generator.wasm`,
    });
    const second = await waitFor((event) => event.type === 'snapshot' && event.runId === 2);
    assert.equal(second.sequence, 1);
    assert.equal(second.metrics.length, 2);
    assert.deepEqual(
      second.metrics.map((metric) => metric.volume),
      expectedVolumes(2, 1, 54321),
    );

    worker.postMessage({
      type: 'start-run',
      runId: 3,
      settings: firstSettings,
      seed: 1,
      wasmUrl: `${origin}/missing.wasm`,
    });
    const error = await waitFor((event) => event.type === 'run-error' && event.runId === 3);
    assert.equal(error.code, 'wasm-fetch');
    worker.postMessage({ type: 'dispose', runId: 3 });
  },
);
