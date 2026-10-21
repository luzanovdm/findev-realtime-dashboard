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

addEventListener('message', ({ data }: MessageEvent<unknown>) => {
  controller.dispatch(data);
});

function send(response: ProducerWorkerEvent): void {
  try {
    postMessage(response);
  } catch {
    controller.dispatch({ type: 'dispose', runId: response.runId });
  }
}
