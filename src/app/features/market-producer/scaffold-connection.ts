import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { isProducerErrorCode, ProducerFault } from './producer-error';
import type { SmokeRequest } from './worker.protocol';

@Injectable({ providedIn: 'root' })
export class ScaffoldConnection {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  // Diagnostic only: creates a short-lived worker and terminates it after the smoke.
  // TODO: replace with your producer ownership and lifecycle when implementing TASK.md.
  check(): Promise<number> {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      return Promise.reject(new ProducerFault('worker-unavailable'));
    }

    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./producer.worker', import.meta.url), { type: 'module' });
      } catch (error: unknown) {
        reject(new ProducerFault('worker-unavailable', error));
        return;
      }

      let settled = false;
      const finish = (error?: ProducerFault, value?: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unregister();
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.onmessage = null;
        worker.terminate();
        if (error) reject(error);
        else resolve(value as number);
      };
      const unregister = this.destroyRef.onDestroy(() => finish(new ProducerFault('worker-crash')));
      const timeout = setTimeout(() => finish(new ProducerFault('worker-timeout')), 5000);
      worker.onerror = () => finish(new ProducerFault('worker-crash'));
      worker.onmessageerror = () => finish(new ProducerFault('protocol'));
      worker.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== 'object' || data === null || !('type' in data)) {
          finish(new ProducerFault('protocol'));
        } else if (data.type === 'smoke-error') {
          finish(
            new ProducerFault(
              'code' in data && isProducerErrorCode(data.code) ? data.code : 'protocol',
            ),
          );
        } else if (data.type === 'smoke-ok' && 'value' in data && data.value === 42) {
          finish(undefined, 42);
        } else {
          finish(new ProducerFault('protocol'));
        }
      };

      try {
        const request: SmokeRequest = {
          type: 'smoke',
          wasmUrl: new URL('wasm/scaffold.wasm', this.document.baseURI).href,
        };
        worker.postMessage(request);
      } catch (error: unknown) {
        finish(new ProducerFault('worker-crash', error));
      }
    });
  }
}
