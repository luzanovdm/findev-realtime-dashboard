import { loadMarketGenerator, MarketGenerator } from './wasm-generator';

const validRecord = [0, 10200, 30, 10196, 10200, 600, 400] as const;

function generatorWithRecords(
  records: readonly (readonly number[])[],
  pointer = 64,
): MarketGenerator {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  if (pointer + records.length * 28 <= memory.buffer.byteLength) {
    for (let record = 0; record < records.length; record++) {
      for (let field = 0; field < 7; field++) {
        view.setInt32(pointer + record * 28 + field * 4, records[record][field], true);
      }
    }
  }
  const generator = new MarketGenerator({
    memory,
    initialize: () => 0,
    generateBatch: () => pointer,
  });
  generator.initialize(1, 1);
  return generator;
}

describe('market generator adapter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('decodes a packed record as Decimal money and bigint quantities', () => {
    const updates = generatorWithRecords([validRecord]).generateBatch(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].priceCents.toFixed()).toBe('10200');
    expect(updates[0].bidCents.toFixed()).toBe('10196');
    expect(updates[0].tradeQuantity).toBe(30n);
    expect(updates[0].bidQuantity).toBe(600n);
    expect(updates[0].askQuantity).toBe(400n);
  });

  it('rejects a bad final record and invalid output pointers', () => {
    const invalid: number[] = [...validRecord];
    invalid[3] = 10201;
    expect(() => generatorWithRecords([validRecord, invalid]).generateBatch(2)).toThrowError(
      expect.objectContaining({ code: 'invalid-update' }),
    );
    expect(() => generatorWithRecords([validRecord], 3).generateBatch(1)).toThrowError(
      expect.objectContaining({ code: 'wasm-abi' }),
    );
    expect(() => generatorWithRecords([validRecord], 65520).generateBatch(1)).toThrowError(
      expect.objectContaining({ code: 'wasm-abi' }),
    );
  });

  it('does not retry a missing asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadMarketGenerator('/missing.wasm')).rejects.toMatchObject({
      code: 'wasm-fetch',
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient fetch failures twice before returning a typed error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const result = loadMarketGenerator('/unavailable.wasm');
    const rejection = expect(result).rejects.toMatchObject({ code: 'wasm-fetch', retryable: true });
    await vi.advanceTimersByTimeAsync(300);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects an incompatible ABI before generation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    const memory = new WebAssembly.Memory({ initial: 1 });
    vi.stubGlobal('WebAssembly', {
      Memory: WebAssembly.Memory,
      instantiate: vi.fn().mockResolvedValue({
        instance: {
          exports: {
            abiVersion: () => 2,
            recordWidth: () => 7,
            initialize: () => 0,
            generateBatch: () => 64,
            memory,
          },
        },
      }),
    });
    await expect(loadMarketGenerator('/wrong-abi.wasm')).rejects.toMatchObject({
      code: 'wasm-abi',
    });
  });
});
