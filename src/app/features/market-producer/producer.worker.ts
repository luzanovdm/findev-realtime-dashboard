/// <reference lib="webworker" />
import { loadScaffoldWasm } from './wasm-scaffold';
import { producerErrorCode } from './producer-error';
import type { SmokeResponse } from './worker.protocol';

addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'smoke') {
    return;
  }

  void handleSmoke(data);
});

async function handleSmoke(data: object): Promise<void> {
  try {
    if (!('wasmUrl' in data) || typeof data.wasmUrl !== 'string' || !data.wasmUrl.trim()) {
      send({ type: 'smoke-error', code: 'protocol' });
      return;
    }

    const wasm = await loadScaffoldWasm(data.wasmUrl);
    const value = wasm.smoke(42);
    if (value !== 42) {
      send({ type: 'smoke-error', code: 'wasm-abi' });
      return;
    }
    send({ type: 'smoke-ok', value });
  } catch (error: unknown) {
    send({ type: 'smoke-error', code: producerErrorCode(error, 'generation') });
  }
}

function send(response: SmokeResponse): void {
  try {
    postMessage(response);
  } catch {
    // The main thread's deadline handles a broken message channel.
  }
}

// TODO: implement actual Wasm producer calls, scheduling and resource lifecycle.
