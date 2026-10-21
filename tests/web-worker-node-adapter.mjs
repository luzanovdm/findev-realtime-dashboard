// Test adapter only. Production uses the browser's real Web Worker API.
import { parentPort, workerData } from 'node:worker_threads';

const messageListeners = new Map();
globalThis.addEventListener = (type, listener) => {
  if (type !== 'message') throw new Error(`Unsupported test event: ${type}`);
  const wrapped = (data) => void listener({ data });
  messageListeners.set(listener, wrapped);
  parentPort.on('message', wrapped);
};
globalThis.removeEventListener = (type, listener) => {
  if (type !== 'message') throw new Error(`Unsupported test event: ${type}`);
  const wrapped = messageListeners.get(listener);
  if (wrapped === undefined) return;
  parentPort.off('message', wrapped);
  messageListeners.delete(listener);
};
globalThis.postMessage = (data) => parentPort.postMessage(data);
await import(workerData.entry);
