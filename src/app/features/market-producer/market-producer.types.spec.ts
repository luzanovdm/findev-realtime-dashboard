import { instrumentSymbol } from './market-producer.types';

describe('instrumentSymbol', () => {
  it('creates stable unique symbols for all supported instruments', () => {
    const symbols = Array.from({ length: 50 }, (_, index) => instrumentSymbol(index));

    expect(symbols[0]).toBe('ASSET-01');
    expect(symbols[49]).toBe('ASSET-50');
    expect(new Set(symbols).size).toBe(50);
  });

  it.each([-1, 50, 1.5, Number.NaN])('rejects an invalid index: %s', (index) => {
    expect(() => instrumentSymbol(index)).toThrow(RangeError);
  });
});
