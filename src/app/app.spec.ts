import { provideTaiga } from '@taiga-ui/core';
import { App } from './app';
import { ScaffoldConnection } from './features/market-producer/scaffold-connection';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('Scaffold routing (not task acceptance tests)', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter(routes)] }));

  it('opens Dashboard by default', async () => {
    const harness = await RouterTestingHarness.create('');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Dashboard');
  });

  it('navigates between both placeholder pages', async () => {
    const harness = await RouterTestingHarness.create('/settings');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Settings');
    await harness.navigateByUrl('/dashboard');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Dashboard');
  });
});

describe('TASK.md acceptance coverage — TODO, not implemented', () => {
  it.todo('metric calculations: example, zero denominators, instrument isolation');
  it.todo('settings validation and applying a new run');
  it.todo('pause/resume and stale-run rejection');
  it.todo('Wasm generator: batch sizes, state and valid market updates');
});

// Checks the real Taiga shell with Node/jsdom infrastructure adapters.
describe('Scaffold shell', () => {
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
  it('renders navigation and requests one diagnostic connection', async () => {
    const check = vi.fn().mockResolvedValue(42);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideTaiga({ mode: 'light' }),
        { provide: ScaffoldConnection, useValue: { check } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tui-root')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('nav a')).toHaveLength(2);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
