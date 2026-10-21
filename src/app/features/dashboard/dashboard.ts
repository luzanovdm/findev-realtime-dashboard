import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import type { ProducerStatus } from '../market-producer/market-producer.types';
import { CurrencyCentsPipe } from './currency-cents.pipe';
import { ImbalancePipe } from './imbalance.pipe';
import { VolumePipe } from './volume.pipe';

const STATUS_PRESENTATION = {
  initializing: { message: 'Initializing market data…', controlLabel: 'Pause' },
  running: { message: 'Live updates running.', controlLabel: 'Pause' },
  paused: {
    message: 'Updates paused. Current values and totals are preserved.',
    controlLabel: 'Resume',
  },
  error: { message: 'Market data unavailable.', controlLabel: 'Pause' },
} as const satisfies Readonly<Record<ProducerStatus, { message: string; controlLabel: string }>>;

@Component({
  selector: 'app-dashboard',
  imports: [TuiButton, CurrencyCentsPipe, ImbalancePipe, VolumePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly producer = inject(MarketProducerFacade);
  readonly presentation = computed(() => STATUS_PRESENTATION[this.producer.status()]);

  toggleGeneration(): void {
    if (this.producer.canPause()) {
      this.producer.pause();
    } else if (this.producer.canResume()) {
      this.producer.resume();
    }
  }
}
