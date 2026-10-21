/// <reference lib="webworker" />
import { loadScaffoldWasm } from './wasm-scaffold';
import { SmokeRequest, SmokeResponse } from './worker.protocol';

addEventListener('message', async ({ data }: MessageEvent<SmokeRequest>) => {
  if (data.type !== 'smoke') return;
  try {
    const wasm = await loadScaffoldWasm(data.wasmUrl);
    const response: SmokeResponse = { type: 'smoke-ok', value: wasm.smoke(42) };
    postMessage(response);
  } catch (error: unknown) {
    const response: SmokeResponse = {
      type: 'smoke-error',
      message: error instanceof Error ? error.message : String(error),
    };
    postMessage(response);
  }
});

// TODO: implement actual Wasm producer calls, scheduling and resource lifecycle.
