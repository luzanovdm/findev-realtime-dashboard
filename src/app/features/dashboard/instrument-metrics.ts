export interface InstrumentMetrics {
  readonly instrument: string;
  readonly lastPriceCents: number | null;
  readonly spreadCents: number | null;
  readonly volume: number;
  readonly vwapCents: number | null;
  readonly imbalance: number | null;
}

// TODO: implement the metric accumulator without retaining all event history.
