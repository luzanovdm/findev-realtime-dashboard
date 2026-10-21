import { draftFieldError, draftFromSettings, parseSettingsDraft } from './settings-draft';

describe('settings draft', () => {
  it('parses defaults and every inclusive range boundary', () => {
    expect(
      parseSettingsDraft(
        draftFromSettings({ instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 }),
      ),
    ).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
    expect(
      parseSettingsDraft({ instrumentCount: '1', updatesPerBatch: '1', batchIntervalMs: '50' }),
    ).not.toBeNull();
    expect(
      parseSettingsDraft({
        instrumentCount: '50',
        updatesPerBatch: '1000',
        batchIntervalMs: '2000',
      }),
    ).not.toBeNull();
  });

  it.each(['', ' ', '1.5', 'NaN', 'Infinity', '1e3', '9007199254740993'])(
    'rejects invalid raw integer %s',
    (value) => {
      expect(draftFieldError('updatesPerBatch', value)).not.toBeNull();
    },
  );

  it('reports the canonical field ranges', () => {
    expect(draftFieldError('instrumentCount', '0')).toBe('Enter a value from 1 to 50.');
    expect(draftFieldError('updatesPerBatch', '1001')).toBe('Enter a value from 1 to 1000.');
    expect(draftFieldError('batchIntervalMs', '49')).toBe('Enter a value from 50 to 2000.');
  });
});
