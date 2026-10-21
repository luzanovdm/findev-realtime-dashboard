import { TestBed } from '@angular/core/testing';
import { ProducerSettingsStorage } from './producer-settings-storage';

const STORAGE_KEY = 'findev.producer-settings.v1';
const settings = { instrumentCount: 2, updatesPerBatch: 10, batchIntervalMs: 50 };

describe('ProducerSettingsStorage', () => {
  beforeEach(() => localStorage.removeItem(STORAGE_KEY));
  afterEach(() => vi.restoreAllMocks());

  it('restores only valid settings saved for this browser', () => {
    const storage = TestBed.inject(ProducerSettingsStorage);
    expect(storage.load()).toBeNull();
    expect(storage.save(settings)).toBe(true);
    expect(storage.load()).toEqual(settings);
  });

  it.each([
    'not json',
    'null',
    '{"instrumentCount":0,"updatesPerBatch":10,"batchIntervalMs":50}',
    '{"instrumentCount":2,"updatesPerBatch":"10","batchIntervalMs":50}',
  ])('ignores invalid stored data without throwing: %s', (raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(TestBed.inject(ProducerSettingsStorage).load()).toBeNull();
  });

  it('contains browser storage failures', () => {
    const storage = TestBed.inject(ProducerSettingsStorage);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError');
    });
    expect(storage.load()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(storage.save(settings)).toBe(false);
  });
});
