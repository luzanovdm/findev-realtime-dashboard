import { ProducerFault } from './producer-error';

// Imported by the worker, never instantiated on Angular's main thread.
export interface ScaffoldExports {
  smoke(value: number): number;
}

export async function loadScaffoldWasm(url: string): Promise<ScaffoldExports> {
  if (typeof WebAssembly === 'undefined') {
    throw new ProducerFault('worker-unavailable');
  }

  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    bytes = await response.arrayBuffer();
  } catch (error: unknown) {
    throw new ProducerFault('wasm-fetch', error);
  }

  let instance: WebAssembly.Instance;
  try {
    ({ instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: () => {
          throw new Error('AssemblyScript runtime aborted');
        },
      },
    }));
  } catch (error: unknown) {
    throw new ProducerFault('wasm-instantiate', error);
  }

  const smoke = instance.exports['smoke'];
  if (typeof smoke !== 'function') {
    throw new ProducerFault('wasm-abi');
  }
  return { smoke: (value) => Number(smoke(value)) };
}
