const MAX_INSTRUMENTS: i32 = 50;
const MAX_BATCH_SIZE: i32 = 1000;
const RECORD_WIDTH: i32 = 7;
const I32_BYTES: i32 = 4;
const MIN_REFERENCE_CENTS: i32 = 100;
const MAX_REFERENCE_CENTS: i32 = 1_000_000_000;
const INITIAL_REFERENCE_CENTS: i32 = 5_000;
const INITIAL_REFERENCE_RANGE: u32 = 10_001;
const ZERO_SEED: u32 = 0x6d2b79f5;

const PRICE_STATE: usize = memory.data(MAX_INSTRUMENTS * I32_BYTES, I32_BYTES);
const OUTPUT: usize = memory.data(MAX_BATCH_SIZE * RECORD_WIDTH * I32_BYTES, I32_BYTES);

let activeInstrumentCount: i32 = 0;
let randomState: u32 = ZERO_SEED;

function nextRandom(): u32 {
  let value = randomState;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  randomState = value;
  return value;
}

function randomBelow(exclusiveMaximum: u32): u32 {
  return nextRandom() % exclusiveMaximum;
}

export function abiVersion(): i32 {
  return 1;
}

export function recordWidth(): i32 {
  return RECORD_WIDTH;
}

export function initialize(instrumentCount: i32, seed: i32): i32 {
  activeInstrumentCount = 0;
  if (instrumentCount < 1 || instrumentCount > MAX_INSTRUMENTS) return -1;

  randomState = seed === 0 ? ZERO_SEED : <u32>seed;
  for (let index: i32 = 0; index < MAX_INSTRUMENTS; index++) {
    const initialPrice =
      index < instrumentCount
        ? INITIAL_REFERENCE_CENTS + <i32>randomBelow(INITIAL_REFERENCE_RANGE)
        : 0;
    store<i32>(PRICE_STATE + <usize>(index * I32_BYTES), initialPrice);
  }
  activeInstrumentCount = instrumentCount;
  return 0;
}

export function generateBatch(batchSize: i32): i32 {
  if (activeInstrumentCount === 0 || batchSize < 1 || batchSize > MAX_BATCH_SIZE) return -1;

  for (let record: i32 = 0; record < batchSize; record++) {
    const instrumentIndex = <i32>randomBelow(<u32>activeInstrumentCount);
    const pricePointer = PRICE_STATE + <usize>(instrumentIndex * I32_BYTES);
    let referenceCents = load<i32>(pricePointer) + <i32>randomBelow(11) - 5;
    if (referenceCents < MIN_REFERENCE_CENTS) referenceCents = MIN_REFERENCE_CENTS;
    if (referenceCents > MAX_REFERENCE_CENTS) referenceCents = MAX_REFERENCE_CENTS;
    store<i32>(pricePointer, referenceCents);

    const bidCents = referenceCents;
    const askCents = bidCents + 1 + <i32>randomBelow(20);
    const priceCents = (nextRandom() & 1) === 0 ? bidCents : askCents;
    const tradeQuantity = 1 + <i32>randomBelow(100);
    const bidQuantity = <i32>randomBelow(1001);
    const askQuantity = <i32>randomBelow(1001);

    const outputPointer = OUTPUT + <usize>(record * RECORD_WIDTH * I32_BYTES);
    store<i32>(outputPointer, instrumentIndex);
    store<i32>(outputPointer + 4, priceCents);
    store<i32>(outputPointer + 8, tradeQuantity);
    store<i32>(outputPointer + 12, bidCents);
    store<i32>(outputPointer + 16, askCents);
    store<i32>(outputPointer + 20, bidQuantity);
    store<i32>(outputPointer + 24, askQuantity);
  }
  return <i32>OUTPUT;
}
