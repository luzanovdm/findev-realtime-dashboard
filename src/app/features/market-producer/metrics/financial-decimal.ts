import Decimal from 'decimal.js';

declare const decimalStringBrand: unique symbol;

export type DecimalString = string & { readonly [decimalStringBrand]: true };

export const FinancialDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export function financialDecimal(value: Decimal.Value): Decimal {
  const decimal = new FinancialDecimal(value);
  if (!decimal.isFinite()) {
    throw new RangeError(`Financial decimal must be finite: ${String(value)}`);
  }

  return decimal;
}

export function toDecimalString(value: Decimal.Value): DecimalString {
  const serialized = financialDecimal(value).toFixed();
  return (serialized === '-0' ? '0' : serialized) as DecimalString;
}

export function toNullableDecimalString(value: Decimal | null): DecimalString | null {
  return value === null ? null : toDecimalString(value);
}

export function fromNullableDecimalString(value: DecimalString | null): Decimal | null {
  return value === null ? null : financialDecimal(value);
}

export function isDecimalString(value: unknown): value is DecimalString {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return false;
  }

  try {
    return toDecimalString(value) === value;
  } catch {
    return false;
  }
}
