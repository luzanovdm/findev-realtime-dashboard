import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTaiga } from '@taiga-ui/core';
import { Subject } from 'rxjs';
import { MarketProducerFacade } from '../market-producer/market-producer.facade';
import { DEFAULT_PRODUCER_SETTINGS } from '../market-producer/producer-settings';
import { Settings } from './settings';
import { requiredElement } from '../../testing/required-element';

function fakeProducer() {
  const activeSettings = signal(DEFAULT_PRODUCER_SETTINGS);
  const status = signal<'running' | 'paused' | 'initializing' | 'error'>('running');
  const runId = signal(1);
  const error = signal(null);
  const settingsSaveStatus = signal<'saved' | 'unavailable' | null>('saved');
  const outcomes = new Subject<'running' | 'error'>();
  const apply = vi.fn((settings: typeof DEFAULT_PRODUCER_SETTINGS) => {
    runId.update((id) => id + 1);
    status.set('initializing');
    return true;
  });
  const outcomeOf = vi.fn(() => outcomes.asObservable());
  return { activeSettings, status, runId, error, settingsSaveStatus, apply, outcomeOf, outcomes };
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
  const input = requiredElement(fixture.nativeElement, `#${id}`, HTMLInputElement);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function submitForm(fixture: ReturnType<typeof TestBed.createComponent<Settings>>): void {
  const form = requiredElement(fixture.nativeElement, 'form', HTMLFormElement);
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
      requiredElement(fixture.nativeElement, '#instrument-count', HTMLInputElement).value,
    ).toBe('5');
    expect(
      requiredElement(fixture.nativeElement, '#updates-per-batch', HTMLInputElement).value,
    ).toBe('100');
    expect(requiredElement(fixture.nativeElement, '#batch-interval', HTMLInputElement).value).toBe(
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
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.textContent).toContain(
      'Applying',
    );
    expect(fixture.nativeElement.querySelector('button[type="submit"]')?.disabled).toBe(true);

    producer.activeSettings.set({ instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 });
    producer.status.set('running');
    producer.outcomes.next('running');
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.settingsForm().submitting()).toBe(false),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.settingsForm().dirty()).toBe(false);
    expect(fixture.componentInstance.draft().instrumentCount).toBe('2');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Saved in this browser',
    );

    producer.status.set('error');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
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

  it('explains when a live Apply could not be saved across reloads', async () => {
    const producer = fakeProducer();
    producer.settingsSaveStatus.set('unavailable');
    const fixture = await createSettings(producer);
    edit(fixture, 'instrument-count', '2');
    await fixture.whenStable();
    submitForm(fixture);
    await fixture.whenStable();
    producer.activeSettings.set({ instrumentCount: 2, updatesPerBatch: 100, batchIntervalMs: 500 });
    producer.status.set('running');
    producer.outcomes.next('running');
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.settingsForm().submitting()).toBe(false),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'settings will reset after reload',
    );
  });

  it('refreshes a pristine draft when accepted settings change elsewhere', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    producer.activeSettings.set({ instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 });
    await fixture.whenStable();
    expect(fixture.componentInstance.draft()).toEqual({
      instrumentCount: '2',
      updatesPerBatch: '10',
      batchIntervalMs: '50',
    });
    expect(fixture.componentInstance.settingsForm().dirty()).toBe(false);
  });

  it('keeps the submitted draft and explains a failed new run', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    edit(fixture, 'instrument-count', '2');
    await fixture.whenStable();
    submitForm(fixture);
    await fixture.whenStable();
    producer.status.set('error');
    producer.outcomes.next('error');
    await fixture.whenStable();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.settingsForm().submitting()).toBe(false),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.draft().instrumentCount).toBe('2');
    expect(fixture.componentInstance.visibleFormError()).toContain('The new run could not start');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'The new run could not start',
    );
    edit(fixture, 'instrument-count', '3');
    await fixture.whenStable();
    expect(fixture.componentInstance.visibleFormError()).toBeUndefined();
  });

  it('releases the pending run outcome when the settings route is destroyed', async () => {
    const producer = fakeProducer();
    const fixture = await createSettings(producer);
    submitForm(fixture);
    await fixture.whenStable();
    expect(producer.outcomes.observed).toBe(true);

    fixture.destroy();
    expect(producer.outcomes.observed).toBe(false);
  });
});
