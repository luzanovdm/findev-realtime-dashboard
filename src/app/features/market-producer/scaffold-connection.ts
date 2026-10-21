import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { SmokeRequest, SmokeResponse } from './worker.protocol';

@Injectable({ providedIn: 'root' })
export class ScaffoldConnection {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  // Diagnostic only: creates a short-lived worker and terminates it after the smoke.
  // TODO: replace with your producer ownership and lifecycle when implementing TASK.md.
  check(): Promise<number> {
    if (typeof Worker === 'undefined') {
      return Promise.reject(new Error('Web Workers are unavailable in this environment'));
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
      const finish = (error?: Error, value?: number): void => {
        clearTimeout(timeout);
        unregister();
        worker.terminate();
        if (error) reject(error);
        else resolve(value!);
      };
      const unregister = this.destroyRef.onDestroy(() =>
        finish(new Error('App destroyed during smoke')),
      );
      const timeout = setTimeout(() => finish(new Error('Worker/Wasm smoke timed out')), 5000);
      worker.onerror = (event) =>
        finish(new Error(`Worker initialization failed: ${event.message}`));
      worker.onmessage = ({ data }: MessageEvent<SmokeResponse>) => {
        if (data.type === 'smoke-error') finish(new Error(data.message));
        else if (data.type === 'smoke-ok' && data.value === 42) finish(undefined, data.value);
        else finish(new Error('Unexpected Worker/Wasm smoke response'));
      };
      const request: SmokeRequest = {
        type: 'smoke',
        wasmUrl: new URL('wasm/scaffold.wasm', this.document.baseURI).href,
      };
      worker.postMessage(request);
    });
  }
}
