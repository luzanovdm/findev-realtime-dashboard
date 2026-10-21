// Imported by the worker, never instantiated on Angular's main thread.
export interface ScaffoldExports {
  smoke(value: number): number;
}

export async function loadScaffoldWasm(url: string): Promise<ScaffoldExports> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Wasm fetch failed: HTTP ${response.status} (${url})`);
  }
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
    env: {
      abort: () => {
        throw new Error('AssemblyScript runtime aborted');
      },
    },
  });
  const smoke = instance.exports['smoke'];
  if (typeof smoke !== 'function') {
    throw new Error('Wasm module is missing the scaffold smoke export');
  }
  return { smoke: (value) => Number(smoke(value)) };
}
