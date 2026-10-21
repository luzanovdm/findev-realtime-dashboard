import { loadScaffoldWasm } from './wasm-scaffold';

describe('scaffold Wasm loader failure mapping', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('classifies network and HTTP errors as fetch failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('private URL')));
    await expect(loadScaffoldWasm('/missing.wasm')).rejects.toMatchObject({ code: 'wasm-fetch' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadScaffoldWasm('/missing.wasm')).rejects.toMatchObject({ code: 'wasm-fetch' });
  });

  it('classifies compilation failure separately from a missing export', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    vi.stubGlobal('WebAssembly', {
      instantiate: vi.fn().mockRejectedValue(new Error('invalid Wasm')),
    });
    await expect(loadScaffoldWasm('/invalid.wasm')).rejects.toMatchObject({
      code: 'wasm-instantiate',
    });

    vi.stubGlobal('WebAssembly', {
      instantiate: vi.fn().mockResolvedValue({ instance: { exports: {} } }),
    });
    await expect(loadScaffoldWasm('/missing-export.wasm')).rejects.toMatchObject({
      code: 'wasm-abi',
    });
  });
});
