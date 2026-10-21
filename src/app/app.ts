import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiRoot } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';
import { AppErrorHandler } from './app-error';
import { AppearanceService } from './core/appearance/appearance.service';
import { MarketProducerFacade } from './features/market-producer/market-producer.facade';
import { ProducerRecoveryAction } from './features/market-producer/market-producer.types';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TuiRoot, TuiButton, TuiBadge, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  readonly producer = inject(MarketProducerFacade);
  readonly appErrors = inject(AppErrorHandler);
  readonly appearance = inject(AppearanceService);
  readonly recoveryAction = ProducerRecoveryAction;
  readonly reloadUrl = inject(DOCUMENT).baseURI;

  ngOnInit(): void {
    this.producer.start();
  }
}
