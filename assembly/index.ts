// Phase 0 ABI spike. Market generation replaces the zero-filled batch in Phase 2.
const MAX_INSTRUMENTS: i32 = 50;
const MAX_BATCH_SIZE: i32 = 1000;
const RECORD_WIDTH: i32 = 7;
const I32_BYTES: i32 = 4;

const PRICE_STATE: usize = memory.data(MAX_INSTRUMENTS * I32_BYTES, I32_BYTES);
const OUTPUT: usize = memory.data(MAX_BATCH_SIZE * RECORD_WIDTH * I32_BYTES, I32_BYTES);

let activeInstrumentCount: i32 = 0;

export function abiVersion(): i32 {
  return 1;
}

export function recordWidth(): i32 {
  return RECORD_WIDTH;
}

export function initialize(instrumentCount: i32, _seed: i32): i32 {
  if (instrumentCount < 1 || instrumentCount > MAX_INSTRUMENTS) return -1;

  activeInstrumentCount = instrumentCount;
  for (let index: i32 = 0; index < MAX_INSTRUMENTS; index++) {
    store<i32>(PRICE_STATE + <usize>(index * I32_BYTES), 0);
  }
  return 0;
}

export function generateBatch(batchSize: i32): i32 {
  if (activeInstrumentCount === 0 || batchSize < 1 || batchSize > MAX_BATCH_SIZE) return -1;

  const fieldCount = batchSize * RECORD_WIDTH;
  for (let field: i32 = 0; field < fieldCount; field++) {
    store<i32>(OUTPUT + <usize>(field * I32_BYTES), 0);
  }
  return <i32>OUTPUT;
}

// Retained until the production worker replaces its scaffold handshake.
export function smoke(value: i32): i32 {
  return value;
}
