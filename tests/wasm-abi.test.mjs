import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const wasmUrl = new URL('../public/wasm/market-generator.wasm', import.meta.url);

test('compiled Wasm exposes the versioned fixed-buffer ABI', async () => {
  const bytes = await readFile(wasmUrl);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  assert.equal(
    imports.some(({ name }) => /random|seed/i.test(name)),
    false,
  );

  const { exports } = await WebAssembly.instantiate(module, {
    env: { abort: () => assert.fail('Wasm aborted') },
  });
  assert.equal(exports.abiVersion(), 1);
  assert.equal(exports.recordWidth(), 7);
  assert.ok(exports.memory instanceof WebAssembly.Memory);

  assert.equal(exports.generateBatch(1), -1, 'generation requires initialization');
  assert.equal(exports.initialize(0, 1), -1);
  assert.equal(exports.initialize(51, 1), -1);
  assert.equal(exports.initialize(50, 1), 0);
  assert.equal(exports.generateBatch(0), -1);
  assert.equal(exports.generateBatch(1001), -1);

  const pointer = exports.generateBatch(1000);
  assert.equal(pointer % 4, 0, 'record pointer is i32-aligned');
  assert.ok(pointer >= 0);
  assert.ok(pointer + 1000 * 7 * 4 <= exports.memory.buffer.byteLength);
  assert.equal(exports.generateBatch(1), pointer, 'all batches reuse the same output buffer');

  const initialBytes = exports.memory.buffer.byteLength;
  for (let index = 0; index < 1000; index++) {
    assert.equal(exports.generateBatch(1000), pointer);
  }
  assert.equal(
    exports.memory.buffer.byteLength,
    initialBytes,
    'repeated batches do not grow memory',
  );
});
