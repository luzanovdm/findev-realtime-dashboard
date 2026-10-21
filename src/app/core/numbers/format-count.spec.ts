import { formatCount } from './format-count';

describe('English integer count formatting', () => {
  it('formats bigint exactly without converting through a number', () => {
    expect(formatCount(0n)).toBe('0');
    expect(formatCount(9007199254740993n)).toBe('9,007,199,254,740,993');
  });
});
