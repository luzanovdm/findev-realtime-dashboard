import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiRoot } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';
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

  ngOnInit(): void {
    this.producer.start();
  }
}
