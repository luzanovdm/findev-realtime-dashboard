/// <reference lib="webworker" />
import { ProducerController } from './producer-controller';
import { loadMarketGenerator } from './wasm-generator';
import type { ProducerWorkerEvent } from './worker.protocol';

const controller = new ProducerController({
  load: loadMarketGenerator,
  emit: send,
  reportFailure: (diagnostic) => console.error('Market producer failure', diagnostic),
  now: () => performance.now(),
  timestampMs: () => Date.now(),
});

function receive({ data }: MessageEvent<unknown>): void {
  controller.dispatch(data);
  if (controller.isDisposed) removeEventListener('message', receive);
}

addEventListener('message', receive);

function send(response: ProducerWorkerEvent): void {
  try {
    postMessage(response);
  } catch {
    controller.dispose();
    removeEventListener('message', receive);
  }
}
