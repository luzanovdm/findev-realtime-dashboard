import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const durationMs = Number(process.argv[2] ?? 300_000);
assert.ok(Number.isSafeInteger(durationMs) && durationMs >= 1_000);

const output = new URL('../dist/findev-realtime-dashboard/browser/', import.meta.url);
const wasm = await readFile(new URL('wasm/market-generator.wasm', output));
const workers = (await readdir(output)).filter((name) => /^worker-.*\.js$/.test(name));
assert.equal(workers.length, 1);

const server = createServer((request, response) => {
  if (request.url !== '/wasm/market-generator.wasm') {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/wasm' });
  response.end(wasm);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const worker = new Worker(new URL('../tests/web-worker-node-adapter.mjs', import.meta.url), {
  workerData: { entry: new URL(workers[0], output).href },
});
const runId = 1;
const instrumentCount = 50;
const batchSize = 1_000;
const seed = 12345;
const snapshots = [];
const messages = [];
worker.on('message', (message) => {
  messages.push(message);
  if (message.type === 'snapshot' && message.runId === runId) {
    snapshots.push({ at: performance.now(), event: message });
  }
});

async function waitFor(predicate) {
  const existing = messages.find(predicate);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('message', onMessage);
      reject(new Error('Timed out waiting for worker event'));
    }, 10_000);
    const onMessage = (message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      worker.off('message', onMessage);
      resolve(message);
    };
    worker.on('message', onMessage);
  });
}

function expectedVolumes(batchCount) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm));
  const { exports } = instance;
  assert.equal(exports.initialize(instrumentCount, seed), 0);
  const volumes = Array.from({ length: instrumentCount }, () => 0n);
  for (let batch = 0; batch < batchCount; batch++) {
    const pointer = exports.generateBatch(batchSize);
    const view = new DataView(exports.memory.buffer, pointer, batchSize * 28);
    for (let record = 0; record < batchSize; record++) {
      const offset = record * 28;
      volumes[view.getInt32(offset, true)] += BigInt(view.getInt32(offset + 8, true));
    }
  }
  return volumes;
}

try {
  worker.postMessage({
    type: 'start-run',
    runId,
    settings: { instrumentCount, updatesPerBatch: batchSize, batchIntervalMs: 50 },
    seed,
    wasmUrl: `http://127.0.0.1:${server.address().port}/wasm/market-generator.wasm`,
  });
  await waitFor((event) => event.type === 'snapshot' && event.runId === runId);
  const startedAt = performance.now();
  const memory = [{ atMs: 0, heap: await worker.getHeapStatistics() }];

  while (performance.now() - startedAt < durationMs) {
    await sleep(Math.min(30_000, durationMs - (performance.now() - startedAt)));
    const atMs = performance.now() - startedAt;
    memory.push({ atMs, heap: await worker.getHeapStatistics() });
    process.stdout.write(
      `Soak progress: ${Math.round(atMs / 1_000)}s, ${snapshots.length} snapshots\n`,
    );
  }

  const pauseSentAt = performance.now();
  worker.postMessage({ type: 'pause', runId });
  await waitFor((event) => event.type === 'status-changed' && event.status === 'paused');
  const pauseLatencyMs = performance.now() - pauseSentAt;
  const last = snapshots.at(-1)?.event;
  assert.ok(last);
  assert.equal(last.metrics.length, instrumentCount);
  assert.deepEqual(
    last.metrics.map((metric) => metric.volume),
    expectedVolumes(last.sequence),
  );

  const activeSeconds = (pauseSentAt - startedAt) / 1_000;
  const runningSnapshots = snapshots.filter((snapshot) => snapshot.at < pauseSentAt);
  const snapshotRate = runningSnapshots.length / activeSeconds;
  const intervals = runningSnapshots
    .slice(1)
    .map((snapshot, index) => snapshot.at - runningSnapshots[index].at);
  const measuredHeap = memory.map(({ atMs, heap }) => ({
    atSeconds: Math.round(atMs / 1_000),
    usedHeapBytes: heap.used_heap_size,
  }));
  process.stdout.write(
    `${JSON.stringify(
      {
        durationSeconds: Math.round(activeSeconds),
        batches: last.sequence,
        updatesAccounted: last.sequence * batchSize,
        runningSnapshots: runningSnapshots.length,
        finalSnapshots: snapshots.length,
        averageSnapshotRateHz: Number(snapshotRate.toFixed(2)),
        shortestSnapshotIntervalMs: Math.round(Math.min(...intervals)),
        pauseLatencyMs: Math.round(pauseLatencyMs),
        workerHeapSamples: measuredHeap,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await worker.terminate();
  await new Promise((resolve) => server.close(resolve));
}
