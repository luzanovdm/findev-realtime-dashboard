import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';

const output = new URL('../dist/findev-realtime-dashboard/browser/', import.meta.url);
const wasmUrl = new URL('wasm/scaffold.wasm', output);

test('compiled AssemblyScript smoke preserves a neutral integer', async () => {
  const bytes = await readFile(wasmUrl);
  assert.ok(WebAssembly.validate(bytes));
  const { instance } = await WebAssembly.instantiate(bytes);
  assert.equal(instance.exports.smoke(42), 42);
  assert.equal(instance.exports.smoke(-7), -7);
});

test(
  'production worker loads and executes the built Wasm over loopback HTTP',
  { timeout: 10000 },
  async (t) => {
    const workers = (await readdir(output)).filter((name) => /^worker-.*\.js$/.test(name));
    assert.equal(workers.length, 1, 'Angular must emit exactly one worker bundle');
    const wasm = await readFile(wasmUrl);
    const server = createServer((request, response) => {
      if (request.url === '/wasm/scaffold.wasm') {
        response.writeHead(200, { 'Content-Type': 'application/wasm' });
        response.end(wasm);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const entry = new URL(workers[0], output).href;

    for (const [path, expectedType] of [
      ['/wasm/scaffold.wasm', 'smoke-ok'],
      ['/missing.wasm', 'smoke-error'],
    ]) {
      // Executes the ACTUAL Angular production worker bundle, not a mocked Wasm producer.
      const worker = new Worker(new URL('./web-worker-node-adapter.mjs', import.meta.url), {
        workerData: { entry },
      });
      try {
        const reply = once(worker, 'message');
        worker.postMessage({ type: 'smoke', wasmUrl: `${origin}${path}` });
        const [message] = await reply;
        assert.equal(message.type, expectedType);
        if (expectedType === 'smoke-ok') assert.equal(message.value, 42);
        else assert.match(message.message, /HTTP 404/);
      } finally {
        await worker.terminate();
      }
    }
  },
);
