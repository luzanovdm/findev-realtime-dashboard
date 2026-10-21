import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTaiga } from '@taiga-ui/core';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import { DEFAULT_PRODUCER_SETTINGS } from '../market-producer/producer-settings';
import { Settings } from './settings';

function fakeProducer() {
  const activeSettings = signal(DEFAULT_PRODUCER_SETTINGS);
  const status = signal<'running' | 'paused' | 'initializing' | 'error'>('running');
  const runId = signal(1);
  const error = signal(null);
  const apply = vi.fn((settings: typeof DEFAULT_PRODUCER_SETTINGS) => {
    runId.update((id) => id + 1);
    status.set('initializing');
    return true;
  });
  return { activeSettings, status, runId, error, apply };
}

async function createSettings(producer: ReturnType<typeof fakeProducer>) {
  await TestBed.configureTestingModule({
    imports: [Settings],
    providers: [
      provideTaiga({ mode: 'light' }),
      { provide: MarketProducerFacade, useValue: producer },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Settings);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function edit(
  fixture: ReturnType<typeof TestBed.createComponent<Settings>>,
  id: string,
  value: string,
): void {
  const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function submitForm(fixture: ReturnType<typeof TestBed.createComponent<Settings>>): void {
  const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('Settings form', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows defaults and keeps edits local until Apply', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    expect(
      (fixture.nativeElement.querySelector('#instrument-count') as HTMLInputElement).value,
    ).toBe('5');
    expect(
      (fixture.nativeElement.querySelector('#updates-per-batch') as HTMLInputElement).value,
    ).toBe('100');
    expect((fixture.nativeElement.querySelector('#batch-interval') as HTMLInputElement).value).toBe(
      '500',
    );

    edit(fixture, 'instrument-count', '2');
    await fixture.whenStable();
    expect(producer.apply).not.toHaveBeenCalled();
    expect(producer.activeSettings().instrumentCount).toBe(5);
    expect(fixture.componentInstance.draft().instrumentCount).toBe('2');
  });

  it('blocks an empty or fractional draft and shows field errors', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    edit(fixture, 'instrument-count', '');
    edit(fixture, 'updates-per-batch', '1.5');
    await fixture.whenStable();
    submitForm(fixture);
    await fixture.whenStable();
    expect(producer.apply).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('#instrument-count-error')?.textContent).toContain(
      'Enter a value',
    );
    expect(fixture.nativeElement.querySelector('#updates-per-batch-error')?.textContent).toContain(
      'whole number',
    );
  });

  it('applies a copied valid draft from paused state and resets after acknowledgement', async () => {
    const producer = fakeProducer();
    producer.status.set('paused');
    const fixture = await createSettings(producer);
    edit(fixture, 'instrument-count', '2');
    edit(fixture, 'updates-per-batch', '10');
    edit(fixture, 'batch-interval', '50');
    await fixture.whenStable();
    submitForm(fixture);
    await fixture.whenStable();
    expect(producer.apply).toHaveBeenCalledExactlyOnceWith({
      instrumentCount: 2,
      updatesPerBatch: 10,
      batchIntervalMs: 50,
    });

    producer.activeSettings.set({ instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 });
    producer.status.set('running');
    await fixture.whenStable();
    expect(fixture.componentInstance.settingsForm().dirty()).toBe(false);
    expect(fixture.componentInstance.draft().instrumentCount).toBe('2');
  });

  it('preserves an unsaved dirty draft when accepted settings change elsewhere', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    edit(fixture, 'instrument-count', '3');
    await fixture.whenStable();
    producer.activeSettings.set({ instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 });
    await fixture.whenStable();
    expect(fixture.componentInstance.draft().instrumentCount).toBe('3');
  });
});
