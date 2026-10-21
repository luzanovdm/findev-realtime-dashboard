import { DatePipe, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiRoot } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';
import { AppErrorHandler } from './app-error';
import { MarketProducerFacade } from './features/market-producer/market-producer.facade';

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
  readonly reloadUrl = inject(DOCUMENT).baseURI;

  ngOnInit(): void {
    this.producer.start();
  }
}
