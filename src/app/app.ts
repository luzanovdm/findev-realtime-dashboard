import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiRoot } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';
import { ScaffoldConnection } from './features/market-producer/scaffold-connection';
import {
  describeProducerError,
  producerErrorCode,
} from './features/market-producer/producer-error';
import type { ProducerError } from './features/market-producer/market-producer.types';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TuiRoot, TuiButton, TuiBadge],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly connection = inject(ScaffoldConnection);
  private readonly destroyRef = inject(DestroyRef);
  readonly startupError = signal<ProducerError | null>(null);
  readonly startupState = signal<'idle' | 'checking' | 'ready' | 'failed'>('idle');

  ngOnInit(): void {
    this.retryInitialization();
  }

  retryInitialization(): void {
    if (this.startupState() === 'checking') return;
    this.startupError.set(null);
    this.startupState.set('checking');

    // Infrastructure smoke only. Replaced by the actual producer lifecycle in Phase 3.
    void this.connection.check().then(
      () => {
        if (this.destroyRef.destroyed) return;
        this.startupState.set('ready');
      },
      (error: unknown) => {
        if (this.destroyRef.destroyed) return;
        this.startupError.set(describeProducerError(producerErrorCode(error, 'worker-crash')));
        this.startupState.set('failed');
      },
    );
  }
}
