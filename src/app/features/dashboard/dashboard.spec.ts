import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTaiga } from '@taiga-ui/core';
import { financialDecimal } from '../../core/money/financial-decimal';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import type { InstrumentMetricSnapshot } from '../market-producer/market-producer.types';
import { Dashboard } from './dashboard';
import { requiredElement } from '../../testing/required-element';

function fakeProducer() {
  const status = signal<'initializing' | 'running' | 'paused' | 'error'>('initializing');
  const stale = signal(false);
  const slow = signal(false);
  const metrics = signal<readonly InstrumentMetricSnapshot[]>([
    {
      instrument: 'ASSET-01',
      lastPriceCents: null,
      spreadCents: null,
      volume: 0n,
      vwapCents: null,
      imbalance: null,
    },
  ]);
  const canPause = computed(() => status() === 'running');
  const canResume = computed(() => status() === 'paused');
  const pause = vi.fn(() => status.set('paused'));
  const resume = vi.fn(() => status.set('running'));
  return { status, stale, slow, metrics, canPause, canResume, pause, resume };
}

async function createDashboard(producer: ReturnType<typeof fakeProducer>) {
  await TestBed.configureTestingModule({
    imports: [Dashboard],
    providers: [
      provideTaiga({ mode: 'light' }),
      { provide: MarketProducerFacade, useValue: producer },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows unavailable values and zero volume before data arrives', async () => {
    const fixture = await createDashboard(fakeProducer());
    const cells = [...fixture.nativeElement.querySelectorAll('tbody td')].map(
      (cell: HTMLTableCellElement) => cell.textContent?.trim(),
    );
    expect(cells).toEqual(['—', '—', '0', '—', '—']);
    expect(fixture.nativeElement.querySelector('tbody th')?.textContent).toBe('ASSET-01');
    expect(requiredElement(fixture.nativeElement, 'button', HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Initializing market data',
    );
  });

  it('renders the worked example from one confirmed snapshot', async () => {
    const producer = fakeProducer();
    const fixture = await createDashboard(producer);
    const button = requiredElement(fixture.nativeElement, 'button', HTMLButtonElement);
    producer.metrics.set([
      {
        instrument: 'ASSET-01',
        lastPriceCents: financialDecimal(10200),
        spreadCents: financialDecimal(4),
        volume: 40n,
        vwapCents: financialDecimal(10150),
        imbalance: financialDecimal('0.2'),
      },
    ]);
    producer.status.set('running');
    await fixture.whenStable();

    const cells = [...fixture.nativeElement.querySelectorAll('tbody td')].map(
      (cell: HTMLTableCellElement) => cell.textContent?.trim(),
    );
    expect(cells).toEqual(['$102.00', '$0.04', '40', '$101.50', '0.20']);
    expect(fixture.nativeElement.querySelector('button')).toBe(button);
    expect(button.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Live updates running',
    );
  });

  it('pauses and resumes while keeping the last displayed snapshot', async () => {
    const producer = fakeProducer();
    producer.status.set('running');
    const fixture = await createDashboard(producer);
    const button = requiredElement(fixture.nativeElement, 'button', HTMLButtonElement);

    button.click();
    await fixture.whenStable();
    expect(producer.pause).toHaveBeenCalledTimes(1);
    expect(button.textContent?.trim()).toBe('Resume');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Updates paused',
    );
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);

    button.click();
    await fixture.whenStable();
    expect(producer.resume).toHaveBeenCalledTimes(1);
    expect(button.textContent?.trim()).toBe('Pause');
  });

  it('marks retained values as outdated after a recoverable producer failure', async () => {
    const producer = fakeProducer();
    const fixture = await createDashboard(producer);
    producer.status.set('error');
    producer.stale.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Last confirmed values are outdated',
    );
    expect(requiredElement(fixture.nativeElement, 'button', HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('shows a nonblocking warning while the worker reports sustained slow delivery', async () => {
    const producer = fakeProducer();
    producer.status.set('running');
    const fixture = await createDashboard(producer);
    producer.slow.set(true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'more slowly than the requested interval',
    );
    producer.slow.set(false);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).not.toContain(
      'more slowly than the requested interval',
    );
  });
});
