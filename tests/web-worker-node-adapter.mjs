// Test adapter only. Production uses the browser's real Web Worker API.
import { parentPort, workerData } from 'node:worker_threads';

globalThis.addEventListener = (type, listener) => {
  if (type !== 'message') throw new Error(`Unsupported test event: ${type}`);
  parentPort.on('message', (data) => void listener({ data }));
};
globalThis.postMessage = (data) => parentPort.postMessage(data);
await import(workerData.entry);
