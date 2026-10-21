import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const bytes = await readFile(new URL('../public/wasm/market-generator.wasm', import.meta.url));
const module = new WebAssembly.Module(bytes);
const FIELDS_PER_RECORD = 7;
const BYTES_PER_RECORD = FIELDS_PER_RECORD * 4;

function createGenerator() {
  return new WebAssembly.Instance(module).exports;
}

function generate(exports, batchSize) {
  const pointer = exports.generateBatch(batchSize);
  assert.ok(pointer >= 0, `invalid batch pointer: ${pointer}`);
  assert.equal(pointer % 4, 0);
  assert.ok(pointer + batchSize * BYTES_PER_RECORD <= exports.memory.buffer.byteLength);

  const view = new DataView(exports.memory.buffer, pointer, batchSize * BYTES_PER_RECORD);
  return Array.from({ length: batchSize }, (_, record) =>
    Array.from({ length: FIELDS_PER_RECORD }, (_, field) =>
      view.getInt32(record * BYTES_PER_RECORD + field * 4, true),
    ),
  );
}

test('compiled generator returns valid records at every requested batch size and instrument boundary', () => {
  for (const instrumentCount of [1, 5, 50]) {
    const exports = createGenerator();
    assert.equal(exports.initialize(instrumentCount, 123456789), 0);

    for (const batchSize of [1, 17, 1000]) {
      const records = generate(exports, batchSize);
      assert.equal(records.length, batchSize);
      for (const [index, price, tradeQuantity, bid, ask, bidQuantity, askQuantity] of records) {
        assert.ok(index >= 0 && index < instrumentCount);
        assert.ok(bid >= 100 && bid <= 1_000_000_000);
        assert.ok(ask > bid && ask - bid <= 20);
        assert.ok(price === bid || price === ask);
        assert.ok(tradeQuantity >= 1 && tradeQuantity <= 100);
        assert.ok(bidQuantity >= 0 && bidQuantity <= 1000);
        assert.ok(askQuantity >= 0 && askQuantity <= 1000);
      }
    }
  }
});

test('the single-instrument random walk continues across calls', () => {
  const exports = createGenerator();
  assert.equal(exports.initialize(1, 4567), 0);
  const records = [...generate(exports, 1000), ...generate(exports, 1000)];

  assert.ok(records[0][3] >= 4995 && records[0][3] <= 15005);
  assert.ok(records.some((record, index) => index > 0 && record[3] !== records[index - 1][3]));
  for (let index = 1; index < records.length; index++) {
    assert.ok(Math.abs(records[index][3] - records[index - 1][3]) <= 5);
  }
});

test('each instrument keeps its own evolving reference price', () => {
  const exports = createGenerator();
  assert.equal(exports.initialize(5, 789), 0);
  const lastBid = new Map();
  const records = [...generate(exports, 1000), ...generate(exports, 1000)];

  for (const [instrumentIndex, , , bid] of records) {
    const previousBid = lastBid.get(instrumentIndex);
    if (previousBid !== undefined) {
      assert.ok(Math.abs(bid - previousBid) <= 5);
    }
    lastBid.set(instrumentIndex, bid);
  }
  assert.equal(lastBid.size, 5);
});

test('equal seeds reproduce all batches and initialization resets state', () => {
  const first = createGenerator();
  const second = createGenerator();
  const different = createGenerator();
  assert.equal(first.initialize(5, 98765), 0);
  assert.equal(second.initialize(5, 98765), 0);
  assert.equal(different.initialize(5, 98766), 0);

  const firstBatch = generate(first, 100);
  assert.deepEqual(generate(second, 100), firstBatch);
  assert.notDeepEqual(generate(different, 100), firstBatch);
  assert.deepEqual(generate(first, 37), generate(second, 37));
  assert.equal(first.initialize(5, 98765), 0);
  assert.deepEqual(generate(first, 100), firstBatch);

  assert.equal(first.initialize(5, 0), 0);
  assert.equal(second.initialize(5, 0), 0);
  assert.deepEqual(generate(first, 100), generate(second, 100));
});

test('invalid inputs stop generation and short batches do not write the next record', () => {
  const exports = createGenerator();
  assert.equal(exports.generateBatch(1), -1);
  assert.equal(exports.initialize(0, 1), -1);
  assert.equal(exports.initialize(51, 1), -1);
  assert.equal(exports.initialize(1, 1), 0);
  assert.equal(exports.generateBatch(0), -1);
  assert.equal(exports.generateBatch(1001), -1);

  const pointer = exports.generateBatch(2);
  const view = new DataView(exports.memory.buffer);
  view.setInt32(pointer + BYTES_PER_RECORD, 0x12345678, true);
  assert.equal(exports.generateBatch(1), pointer);
  assert.equal(view.getInt32(pointer + BYTES_PER_RECORD, true), 0x12345678);

  assert.equal(exports.initialize(0, 1), -1);
  assert.equal(exports.generateBatch(1), -1, 'invalid reinitialization disables the old run');
});

test('hot-path memory remains flat and randomness has no host import', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const exports = createGenerator();
  assert.equal(exports.initialize(50, 42), 0);
  const initialBytes = exports.memory.buffer.byteLength;
  for (let index = 0; index < 1000; index++) {
    assert.ok(exports.generateBatch(1000) >= 0);
  }
  assert.equal(exports.memory.buffer.byteLength, initialBytes);
});
