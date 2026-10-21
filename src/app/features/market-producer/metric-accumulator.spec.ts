import { financialDecimal } from './financial-decimal';
import type { MarketUpdate } from './market-producer.types';
import { MetricAccumulator } from './metric-accumulator';

function update(
  instrumentIndex: number,
  priceCents: string,
  tradeQuantity: bigint,
  bidCents: string,
  askCents: string,
  bidQuantity: bigint,
  askQuantity: bigint,
): MarketUpdate {
  return {
    instrumentIndex,
    priceCents: financialDecimal(priceCents),
    tradeQuantity,
    bidCents: financialDecimal(bidCents),
    askCents: financialDecimal(askCents),
    bidQuantity,
    askQuantity,
  };
}

describe('MetricAccumulator', () => {
  it('starts with unavailable values and zero volume for each instrument', () => {
    const snapshot = new MetricAccumulator(2).snapshot();
    expect(snapshot.map((row) => row.instrument)).toEqual(['ASSET-01', 'ASSET-02']);
    for (const row of snapshot) {
      expect(row.lastPriceCents).toBeNull();
      expect(row.spreadCents).toBeNull();
      expect(row.volume).toBe(0n);
      expect(row.vwapCents).toBeNull();
      expect(row.imbalance).toBeNull();
    }
  });

  it('calculates the assignment example without rounding monetary state', () => {
    const accumulator = new MetricAccumulator(1);
    accumulator.applyBatch([
      update(0, '10000', 10n, '9996', '10000', 500n, 500n),
      update(0, '10200', 30n, '10196', '10200', 600n, 400n),
    ]);

    const row = accumulator.snapshot()[0];
    expect(row.lastPriceCents?.toFixed()).toBe('10200');
    expect(row.spreadCents?.toFixed()).toBe('4');
    expect(row.volume).toBe(40n);
    expect(row.vwapCents?.toFixed()).toBe('10150');
    expect(row.imbalance?.toFixed()).toBe('0.2');
    expect(accumulator.serializedSnapshot()[0]).toEqual({
      instrument: 'ASSET-01',
      lastPriceCents: '10200',
      spreadCents: '4',
      volume: 40n,
      vwapCents: '10150',
      imbalance: '0.2',
    });
  });

  it('counts repeated trades, isolates instruments, and treats an empty book as unavailable', () => {
    const accumulator = new MetricAccumulator(2);
    accumulator.applyBatch([
      update(0, '100', 1n, '100', '101', 0n, 0n),
      update(1, '200', 2n, '200', '201', 5n, 0n),
      update(0, '101', 3n, '100', '101', 0n, 0n),
    ]);

    const [first, second] = accumulator.snapshot();
    expect(first.volume).toBe(4n);
    expect(first.vwapCents?.toFixed()).toBe('100.75');
    expect(first.imbalance).toBeNull();
    expect(second.volume).toBe(2n);
    expect(second.lastPriceCents?.toFixed()).toBe('200');
    expect(second.imbalance?.toFixed()).toBe('1');
  });

  it('keeps notional arithmetic exact beyond binary floating-point integer precision', () => {
    const accumulator = new MetricAccumulator(1);
    accumulator.applyBatch([
      update(0, '1000000000', 2_000_000_000n, '1000000000', '1000000001', 1n, 1n),
      update(0, '1000000001', 2_000_000_000n, '1000000000', '1000000001', 1n, 1n),
    ]);

    expect(accumulator.snapshot()[0].volume).toBe(4_000_000_000n);
    expect(accumulator.snapshot()[0].vwapCents?.toFixed()).toBe('1000000000.5');
  });

  it('rejects a bad late record without applying earlier records from the batch', () => {
    const accumulator = new MetricAccumulator(1);
    accumulator.applyBatch([update(0, '100', 2n, '100', '101', 1n, 1n)]);
    const before = accumulator.serializedSnapshot();

    expect(() =>
      accumulator.applyBatch([
        update(0, '101', 3n, '100', '101', 1n, 1n),
        update(0, '99', 1n, '100', '101', 1n, 1n),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-update' }));
    expect(accumulator.serializedSnapshot()).toEqual(before);
  });

  it('does not commit any records when a Decimal calculation fails', () => {
    const accumulator = new MetricAccumulator(1);
    const failed = update(0, '101', 1n, '100', '101', 1n, 1n);
    vi.spyOn(failed.priceCents, 'times').mockImplementation(() => {
      throw new Error('private calculation detail');
    });

    expect(() =>
      accumulator.applyBatch([update(0, '100', 1n, '100', '101', 1n, 1n), failed]),
    ).toThrowError(expect.objectContaining({ code: 'metric-failure' }));
    expect(accumulator.snapshot()[0].volume).toBe(0n);
    expect(accumulator.snapshot()[0].lastPriceCents).toBeNull();
  });
});
