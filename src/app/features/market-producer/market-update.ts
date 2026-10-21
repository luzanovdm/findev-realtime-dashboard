export interface MarketUpdate {
  readonly instrument: string;
  readonly priceCents: number;
  readonly tradeQuantity: number;
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
}

// TODO: choose and implement the Wasm batch ABI and run protocol.
