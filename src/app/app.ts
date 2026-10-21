import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TuiButton, TuiRoot } from '@taiga-ui/core';
import { TuiBadge } from '@taiga-ui/kit';
import { ScaffoldConnection } from './features/market-producer/scaffold-connection';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TuiRoot, TuiButton, TuiBadge],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly connection = inject(ScaffoldConnection);

  ngOnInit(): void {
    // Infrastructure smoke only. TODO: implement the actual producer lifecycle yourself.
    void this.connection.check().then(
      () => console.info('[scaffold] Worker/Wasm smoke passed; no market producer implemented.'),
      (error: unknown) => console.error('[scaffold] Worker/Wasm initialization failed:', error),
    );
  }
}
