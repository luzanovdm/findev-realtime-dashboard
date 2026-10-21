import {
  catchError,
  defer,
  firstValueFrom,
  from,
  retry,
  switchMap,
  throwError,
  timer,
  timeout,
} from 'rxjs';
import { financialDecimal } from '../../../core/money/financial-decimal';
import { isIntegerInRange } from '../../../core/validation/integer-range';
import { ProducerErrorCode } from '../market-producer.types';
import type { MarketUpdate } from '../market-producer.types';
import { ProducerFault } from '../producer-error';
import {
  isGeneratorBatchSize,
  isGeneratorInstrumentCount,
  isGeneratorSeed,
} from './generator-contract';

const ABI_VERSION = 1;
const RECORD_WIDTH = 7;
const RECORD_BYTES = RECORD_WIDTH * Int32Array.BYTES_PER_ELEMENT;
const WASM_LOAD_DEADLINE_MS = 4_500;

interface GeneratedRecord {
  readonly instrumentIndex: number;
  readonly priceCents: number;
  readonly tradeQuantity: number;
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
}

type RecordRule = (record: GeneratedRecord, instrumentCount: number) => boolean;

const RECORD_RULES = Object.values({
  instrumentInRun: (record, instrumentCount) =>
    record.instrumentIndex >= 0 && record.instrumentIndex < instrumentCount,
  positiveTrade: (record) => record.priceCents > 0 && record.tradeQuantity > 0,
  orderedQuote: (record) => record.bidCents > 0 && record.askCents > record.bidCents,
  tradeAtQuote: (record) =>
    record.priceCents === record.bidCents || record.priceCents === record.askCents,
  nonNegativeBook: (record) => record.bidQuantity >= 0 && record.askQuantity >= 0,
} satisfies Readonly<Record<string, RecordRule>>);

function isOutputSlice(pointer: number, byteCount: number, bufferBytes: number): boolean {
  const withinMemory = isIntegerInRange(pointer, {
    minimum: 0,
    maximum: bufferBytes - byteCount,
  });
  const aligned = pointer % Int32Array.BYTES_PER_ELEMENT === 0;
  return withinMemory && aligned;
}

interface GeneratorExports {
  readonly memory: WebAssembly.Memory;
  readonly initialize: (instrumentCount: number, seed: number) => number;
  readonly generateBatch: (batchSize: number) => number;
}

interface RequiredWasmExports {
  readonly memory: WebAssembly.Memory;
  readonly abiVersion: () => number;
  readonly recordWidth: () => number;
  readonly initialize: (instrumentCount: number, seed: number) => number;
  readonly generateBatch: (batchSize: number) => number;
}

const REQUIRED_FUNCTION_EXPORTS = [
  'abiVersion',
  'recordWidth',
  'initialize',
  'generateBatch',
] as const;

function hasRequiredExports(
  exports: WebAssembly.Exports,
): exports is WebAssembly.Exports & RequiredWasmExports {
  return (
    REQUIRED_FUNCTION_EXPORTS.every((name) => typeof exports[name] === 'function') &&
    exports['memory'] instanceof WebAssembly.Memory
  );
}

export class WasmFetchFault extends ProducerFault {
  constructor(
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(ProducerErrorCode.WasmFetch, cause);
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
    this.instrumentCount = 0;
    if (!isGeneratorInstrumentCount(instrumentCount) || !isGeneratorSeed(seed)) {
      throw new ProducerFault(ProducerErrorCode.Protocol);
    }

    try {
      if (this.wasm.initialize(instrumentCount, seed) !== 0) {
        throw new ProducerFault(ProducerErrorCode.WasmAbi);
      }
    } catch (error: unknown) {
      if (error instanceof ProducerFault) throw error;
      throw new ProducerFault(ProducerErrorCode.Generation, error);
    }
    this.instrumentCount = instrumentCount;
  }

  generateBatch(batchSize: number): readonly MarketUpdate[] {
    if (this.instrumentCount === 0 || !isGeneratorBatchSize(batchSize)) {
      throw new ProducerFault(ProducerErrorCode.Protocol);
    }

    let pointer: number;
    try {
      pointer = this.wasm.generateBatch(batchSize);
    } catch (error: unknown) {
      throw new ProducerFault(ProducerErrorCode.Generation, error);
    }

    const buffer = this.wasm.memory.buffer;
    const byteCount = batchSize * RECORD_BYTES;
    if (!isOutputSlice(pointer, byteCount, buffer.byteLength)) {
      throw new ProducerFault(ProducerErrorCode.WasmAbi, {
        expected: 'an aligned pointer to the complete output batch',
        observed: { pointer, byteCount, memoryBytes: buffer.byteLength },
      });
    }

    const view = new DataView(buffer, pointer, byteCount);
    const updates: MarketUpdate[] = [];
    for (let record = 0; record < batchSize; record++) {
      const offset = record * RECORD_BYTES;
      const decoded: GeneratedRecord = {
        instrumentIndex: view.getInt32(offset, true),
        priceCents: view.getInt32(offset + 4, true),
        tradeQuantity: view.getInt32(offset + 8, true),
        bidCents: view.getInt32(offset + 12, true),
        askCents: view.getInt32(offset + 16, true),
        bidQuantity: view.getInt32(offset + 20, true),
        askQuantity: view.getInt32(offset + 24, true),
      };

      if (!RECORD_RULES.every((rule) => rule(decoded, this.instrumentCount))) {
        throw new ProducerFault(ProducerErrorCode.InvalidUpdate, {
          record,
          expected: 'a valid trade and bid/ask snapshot',
          observed: decoded,
        });
      }

      const bidCents = financialDecimal(decoded.bidCents);
      const askCents = financialDecimal(decoded.askCents);
      updates.push({
        instrumentIndex: decoded.instrumentIndex,
        priceCents: decoded.priceCents === decoded.bidCents ? bidCents : askCents,
        tradeQuantity: BigInt(decoded.tradeQuantity),
        bidCents,
        askCents,
        bidQuantity: BigInt(decoded.bidQuantity),
        askQuantity: BigInt(decoded.askQuantity),
      });
    }
    return updates;
  }
}

export async function loadMarketGenerator(
  url: string,
  signal?: AbortSignal,
): Promise<GeneratorPort> {
  if (typeof WebAssembly === 'undefined')
    throw new ProducerFault(ProducerErrorCode.WorkerUnavailable);

  const bytes = await firstValueFrom(
    defer(() => from(fetch(url, { signal: signal ?? null }))).pipe(
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
      timeout({
        first: WASM_LOAD_DEADLINE_MS,
        with: () => throwError(() => new WasmFetchFault(false, new Error('Wasm load timed out'))),
      }),
    ),
  );

  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await firstValueFrom(
      from(
        WebAssembly.instantiate(bytes, {
          env: {
            abort: () => {
              throw new Error('Wasm runtime aborted');
            },
          },
        }),
      ).pipe(
        timeout({
          first: WASM_LOAD_DEADLINE_MS,
        }),
      ),
    ));
  } catch (error: unknown) {
    throw new ProducerFault(ProducerErrorCode.WasmInstantiate, error);
  }

  const exports = instance.exports;
  if (!hasRequiredExports(exports)) throw new ProducerFault(ProducerErrorCode.WasmAbi);

  try {
    if (exports.abiVersion() !== ABI_VERSION || exports.recordWidth() !== RECORD_WIDTH) {
      throw new ProducerFault(ProducerErrorCode.WasmAbi);
    }
  } catch (error: unknown) {
    throw new ProducerFault(ProducerErrorCode.WasmAbi, error);
  }

  return new MarketGenerator({
    memory: exports.memory,
    initialize: (instrumentCount, seed) => Number(exports.initialize(instrumentCount, seed)),
    generateBatch: (batchSize) => Number(exports.generateBatch(batchSize)),
  });
}
