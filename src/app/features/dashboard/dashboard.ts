import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import { formatCurrencyCents, formatImbalance, formatVolume } from './market-metric-formatters';

@Component({
  selector: 'app-dashboard',
  imports: [TuiButton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly producer = inject(MarketProducerFacade);
  readonly formatCurrencyCents = formatCurrencyCents;
  readonly formatImbalance = formatImbalance;
  readonly formatVolume = formatVolume;

  toggleGeneration(): void {
    if (this.producer.canPause()) {
      this.producer.pause();
    } else if (this.producer.canResume()) {
      this.producer.resume();
    }
  }
}
