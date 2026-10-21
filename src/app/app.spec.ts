import { signal } from '@angular/core';
import { provideTaiga } from '@taiga-ui/core';
import { App } from './app';
import { MarketProducerFacade } from './features/market-producer/market-producer.facade';
import { describeProducerError } from './features/market-producer/producer-error';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { AppErrorHandler } from './app-error';

describe('Application routing', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it('opens Dashboard by default', async () => {
    const harness = await RouterTestingHarness.create('');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Dashboard');
  });

  it('navigates between dashboard and settings', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Settings');
    await harness.navigateByUrl('/dashboard');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Dashboard');
  });
});

// Checks the real Taiga shell with Node/jsdom infrastructure adapters.
describe('Application shell', () => {
  beforeEach(() => {
    // jsdom has no viewport media queries; this is not a browser rendering test.
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it('renders navigation and starts one application-scoped producer', async () => {
    const producer = {
      start: vi.fn(),
      retry: vi.fn(),
      status: signal('running'),
      error: signal(null),
      stale: signal(false),
      snapshotAt: signal(null),
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideTaiga({ mode: 'light' }),
        { provide: MarketProducerFacade, useValue: producer },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tui-root')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('nav a')).toHaveLength(2);
    expect(producer.start).toHaveBeenCalledTimes(1);
  });

  it('shows a safe producer error and offers a new run without losing navigation', async () => {
    const producer = {
      start: vi.fn(),
      retry: vi.fn(),
      status: signal('error'),
      error: signal(describeProducerError('wasm-fetch')),
      stale: signal(false),
      snapshotAt: signal<number | null>(null),
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideTaiga({ mode: 'light' }),
        { provide: MarketProducerFacade, useValue: producer },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('Market data could not be loaded');
    expect(fixture.nativeElement.querySelectorAll('nav a')).toHaveLength(2);

    (alert.querySelector('button') as HTMLButtonElement).click();
    expect(producer.retry).toHaveBeenCalledTimes(1);
  });

  it('shows a safe fallback when an unexpected interface error is reported', async () => {
    const producer = {
      start: vi.fn(),
      retry: vi.fn(),
      status: signal('running'),
      error: signal(null),
      stale: signal(false),
      snapshotAt: signal(null),
    };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideTaiga({ mode: 'light' }),
        { provide: MarketProducerFacade, useValue: producer },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      TestBed.inject(AppErrorHandler).handleError(new Error('private error detail'));
      await fixture.whenStable();
      const alert = fixture.nativeElement.querySelector('.application-error') as HTMLElement;
      expect(alert.textContent).toContain('An unexpected interface error occurred');
      expect(alert.textContent).not.toContain('private error detail');
      expect(alert.querySelector('a')?.getAttribute('href')).toBe(document.baseURI);
      expect(fixture.nativeElement.querySelectorAll('nav a')).toHaveLength(2);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });
});
