import { catchError, defer, firstValueFrom, from, retry, switchMap, throwError, timer } from 'rxjs';
import { financialDecimal } from './financial-decimal';
import type { MarketUpdate } from './market-producer.types';
import { ProducerFault } from './producer-error';

const ABI_VERSION = 1;
const RECORD_WIDTH = 7;
const RECORD_BYTES = RECORD_WIDTH * Int32Array.BYTES_PER_ELEMENT;
const MAX_BATCH_SIZE = 1_000;

interface GeneratorExports {
  readonly memory: WebAssembly.Memory;
  readonly initialize: (instrumentCount: number, seed: number) => number;
  readonly generateBatch: (batchSize: number) => number;
}

export class WasmFetchFault extends ProducerFault {
  constructor(
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super('wasm-fetch', cause);
  }
}

export interface GeneratorPort {
  initialize(instrumentCount: number, seed: number): void;
  generateBatch(batchSize: number): readonly MarketUpdate[];
}

export class MarketGenerator implements GeneratorPort {
  private instrumentCount = 0;

  constructor(private readonly wasm: GeneratorExports) {}

  initialize(instrumentCount: number, seed: number): void {
    if (
      !Number.isInteger(instrumentCount) ||
      instrumentCount < 1 ||
      instrumentCount > 50 ||
      !Number.isInteger(seed) ||
      seed < 1 ||
      seed > 0xffff_ffff
    ) {
      throw new ProducerFault('protocol');
    }

    this.instrumentCount = 0;
    try {
      if (this.wasm.initialize(instrumentCount, seed) !== 0) {
        throw new ProducerFault('wasm-abi');
      }
    } catch (error: unknown) {
      if (error instanceof ProducerFault) throw error;
      throw new ProducerFault('generation', error);
    }
    this.instrumentCount = instrumentCount;
  }

  generateBatch(batchSize: number): readonly MarketUpdate[] {
    if (
      this.instrumentCount === 0 ||
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new ProducerFault('protocol');
    }

    let pointer: number;
    try {
      pointer = this.wasm.generateBatch(batchSize);
    } catch (error: unknown) {
      throw new ProducerFault('generation', error);
    }

    const buffer = this.wasm.memory.buffer;
    const byteCount = batchSize * RECORD_BYTES;
    if (
      !Number.isSafeInteger(pointer) ||
      pointer < 0 ||
      pointer % Int32Array.BYTES_PER_ELEMENT !== 0 ||
      pointer + byteCount > buffer.byteLength
    ) {
      throw new ProducerFault('wasm-abi');
    }

    const view = new DataView(buffer, pointer, byteCount);
    const updates: MarketUpdate[] = [];
    for (let record = 0; record < batchSize; record++) {
      const offset = record * RECORD_BYTES;
      const instrumentIndex = view.getInt32(offset, true);
      const priceCents = view.getInt32(offset + 4, true);
      const tradeQuantity = view.getInt32(offset + 8, true);
      const bidCents = view.getInt32(offset + 12, true);
      const askCents = view.getInt32(offset + 16, true);
      const bidQuantity = view.getInt32(offset + 20, true);
      const askQuantity = view.getInt32(offset + 24, true);

      if (
        instrumentIndex < 0 ||
        instrumentIndex >= this.instrumentCount ||
        priceCents <= 0 ||
        tradeQuantity <= 0 ||
        bidCents <= 0 ||
        askCents <= bidCents ||
        (priceCents !== bidCents && priceCents !== askCents) ||
        bidQuantity < 0 ||
        askQuantity < 0
      ) {
        throw new ProducerFault('invalid-update');
      }

      updates.push({
        instrumentIndex,
        priceCents: financialDecimal(priceCents),
        tradeQuantity: BigInt(tradeQuantity),
        bidCents: financialDecimal(bidCents),
        askCents: financialDecimal(askCents),
        bidQuantity: BigInt(bidQuantity),
        askQuantity: BigInt(askQuantity),
      });
    }
    return updates;
  }
}

export async function loadMarketGenerator(
  url: string,
  signal?: AbortSignal,
): Promise<GeneratorPort> {
  if (typeof WebAssembly === 'undefined') throw new ProducerFault('worker-unavailable');

  const bytes = await firstValueFrom(
    defer(() => from(fetch(url, { signal }))).pipe(
      switchMap((response) => {
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          return throwError(
            () => new WasmFetchFault(retryable, new Error(`HTTP ${response.status}`)),
          );
        }
        const contentType = response.headers?.get('content-type');
        if (contentType && !/^application\/wasm(?:\s*;|$)/i.test(contentType)) {
          return throwError(() => new WasmFetchFault(false, new Error('Unexpected content type')));
        }
        return from(response.arrayBuffer());
      }),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof WasmFetchFault ? error : new WasmFetchFault(!signal?.aborted, error),
        ),
      ),
      retry({
        count: 2,
        delay: (error: WasmFetchFault, retryCount) =>
          error.retryable && !signal?.aborted ? timer(100 * retryCount) : throwError(() => error),
      }),
    ),
  );

  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: () => {
          throw new Error('Wasm runtime aborted');
        },
      },
    }));
  } catch (error: unknown) {
    throw new ProducerFault('wasm-instantiate', error);
  }

  const exports = instance.exports;
  const abiVersion = exports['abiVersion'];
  const recordWidth = exports['recordWidth'];
  const initialize = exports['initialize'];
  const generateBatch = exports['generateBatch'];
  const memory = exports['memory'];
  if (
    typeof abiVersion !== 'function' ||
    typeof recordWidth !== 'function' ||
    typeof initialize !== 'function' ||
    typeof generateBatch !== 'function' ||
    !(memory instanceof WebAssembly.Memory)
  ) {
    throw new ProducerFault('wasm-abi');
  }

  try {
    if (abiVersion() !== ABI_VERSION || recordWidth() !== RECORD_WIDTH) {
      throw new ProducerFault('wasm-abi');
    }
  } catch (error: unknown) {
    throw new ProducerFault('wasm-abi', error);
  }

  return new MarketGenerator({
    memory,
    initialize: (instrumentCount, seed) => Number(initialize(instrumentCount, seed)),
    generateBatch: (batchSize) => Number(generateBatch(batchSize)),
  });
}
