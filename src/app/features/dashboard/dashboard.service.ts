import { computed, inject, Injectable } from '@angular/core';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import type { ProducerStatus } from '../market-producer/market-producer.types';

const STATUS_PRESENTATION = {
  initializing: { message: 'Initializing market data…', controlLabel: 'Pause', action: null },
  running: {
    message: 'Live updates running.',
    controlLabel: 'Pause',
    action: (producer: MarketProducerFacade) => producer.pause(),
  },
  paused: {
    message: 'Updates paused. Current values and totals are preserved.',
    controlLabel: 'Resume',
    action: (producer: MarketProducerFacade) => producer.resume(),
  },
  error: { message: 'Market data unavailable.', controlLabel: 'Pause', action: null },
} as const satisfies Readonly<
  Record<
    ProducerStatus,
    {
      message: string;
      controlLabel: string;
      action: ((producer: MarketProducerFacade) => void) | null;
    }
  >
>;

@Injectable()
export class DashboardService {
  private readonly producer = inject(MarketProducerFacade);
  readonly metrics = this.producer.metrics;
  readonly stale = this.producer.stale;
  readonly slow = this.producer.slow;
  readonly presentation = computed(() => STATUS_PRESENTATION[this.producer.status()]);
  readonly canToggle = computed(() => this.producer.canPause() || this.producer.canResume());

  toggleGeneration(): void {
    if (this.canToggle()) this.presentation().action?.(this.producer);
  }
}
