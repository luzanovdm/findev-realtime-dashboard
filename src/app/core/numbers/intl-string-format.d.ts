// ECMA-402 accepts exact decimal strings; TypeScript's bundled overloads omit them.
declare namespace Intl {
  interface NumberFormat {
    format(value: string): string;
  }
}
