/// <reference lib="webworker" />
import { loadScaffoldWasm } from './wasm-scaffold';
import { producerErrorCode } from './producer-error';
import { ProducerController } from './producer-controller';
import { loadMarketGenerator } from './wasm-generator';
import type { ProducerWorkerEvent, SmokeResponse } from './worker.protocol';

const controller = new ProducerController({
  load: loadMarketGenerator,
  emit: send,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
  now: () => performance.now(),
  timestampMs: () => Date.now(),
});

addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'smoke') {
    void handleSmoke(data);
  } else {
    controller.dispatch(data);
  }
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

function send(response: SmokeResponse | ProducerWorkerEvent): void {
  try {
    postMessage(response);
  } catch {
    if ('runId' in response) controller.dispatch({ type: 'dispose', runId: response.runId });
  }
}
