import { DatePipe, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';

interface BuildInfo {
  commit: string;
  builtAt: string;
}

@Component({
  selector: 'app-build-version',
  imports: [DatePipe],
  template: `
    @if (info(); as build) {
      <span
        >Build <code>{{ build.commit.slice(0, 7) }}</code></span
      >
      <time [attr.datetime]="build.builtAt" [title]="build.builtAt">
        Built {{ build.builtAt | date: 'yyyy-MM-dd HH:mm' : 'UTC' }} UTC
      </time>
    } @else {
      <span>{{ loading() ? 'Loading build info…' : 'Build info unavailable' }}</span>
    }
  `,
  styleUrl: './build-version.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BuildVersion implements OnInit {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  readonly info = signal<BuildInfo | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    const controller = new AbortController();
    this.destroyRef.onDestroy(() => controller.abort());
    void this.load(controller.signal);
  }

  private async load(signal: AbortSignal): Promise<void> {
    try {
      const response = await fetch(new URL('build-info.json', this.document.baseURI), {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (
        value &&
        typeof value === 'object' &&
        'commit' in value &&
        typeof value.commit === 'string' &&
        /^[a-f0-9]{7,64}$/i.test(value.commit) &&
        'builtAt' in value &&
        typeof value.builtAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.builtAt) &&
        Number.isFinite(Date.parse(value.builtAt))
      ) {
        this.info.set({ commit: value.commit, builtAt: value.builtAt });
      }
    } catch {
      // Metadata is optional; failure must not affect the dashboard or producer.
    } finally {
      this.loading.set(false);
    }
  }
}
