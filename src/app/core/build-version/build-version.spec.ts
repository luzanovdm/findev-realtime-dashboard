import { TestBed } from '@angular/core/testing';
import { BuildVersion } from './build-version';

const build = {
  commit: '1e0be7a5534418d810feab6fd0b82e3593431b5d',
  builtAt: '2026-10-23T13:30:00.000Z',
};

describe('Build version', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders before metadata resolves, then shows commit and UTC build time', async () => {
    let resolve!: (response: Response) => void;
    const request = new Promise<Response>((done) => (resolve = done));
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(request));
    const fixture = TestBed.createComponent(BuildVersion);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading build info');
    resolve(Response.json(build));
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1e0be7a');
    expect(fixture.nativeElement.textContent).toContain('Built 2026-10-23 13:30 UTC');
    expect(fixture.nativeElement.querySelector('time').dateTime).toBe(build.builtAt);
  });

  it.each([
    new Response(null, { status: 404 }),
    new Response('<html>SPA fallback</html>'),
    Response.json({ commit: 'unknown', builtAt: build.builtAt }),
    Response.json({ ...build, builtAt: 'invalid' }),
  ])('keeps metadata failure separate from application state', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const fixture = TestBed.createComponent(BuildVersion);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Build info unavailable');
    expect(fixture.componentInstance.info()).toBeNull();
  });

  it('aborts the optional request when the shell is destroyed', () => {
    const request = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', request);
    const fixture = TestBed.createComponent(BuildVersion);
    fixture.detectChanges();
    const options = request.mock.calls[0]?.[1] as RequestInit;
    fixture.destroy();
    expect(options.signal?.aborted).toBe(true);
  });
});
