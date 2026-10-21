const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatCount(value: bigint): string {
  return COUNT_FORMAT.format(value);
}
