import { TestBed } from '@angular/core/testing';
import { TUI_DARK_MODE, TUI_DARK_MODE_DEFAULT_KEY, provideTaiga } from '@taiga-ui/core';
import { AppearanceService, ThemePreference } from './appearance.service';

describe('appearance preference', () => {
  let systemDark: boolean;
  let media: EventTarget;

  beforeEach(() => {
    localStorage.removeItem(TUI_DARK_MODE_DEFAULT_KEY);
    systemDark = false;
    media = new EventTarget();
    Object.defineProperty(media, 'matches', { get: () => systemDark });
    vi.stubGlobal('matchMedia', () => media);
    TestBed.configureTestingModule({ providers: [provideTaiga()] });
  });

  afterEach(() => {
    localStorage.removeItem(TUI_DARK_MODE_DEFAULT_KEY);
    vi.unstubAllGlobals();
  });

  it('follows system color changes until a preference is selected', () => {
    const appearance = TestBed.inject(AppearanceService);
    const darkMode = TestBed.inject(TUI_DARK_MODE);
    expect(appearance.preference()).toBe(ThemePreference.System);
    expect(darkMode()).toBe(false);

    systemDark = true;
    media.dispatchEvent(new Event('change'));
    expect(darkMode()).toBe(true);

    appearance.select(ThemePreference.Light);
    expect(appearance.preference()).toBe(ThemePreference.Light);
    expect(darkMode()).toBe(false);
    expect(localStorage.getItem(TUI_DARK_MODE_DEFAULT_KEY)).toBe('false');

    systemDark = false;
    media.dispatchEvent(new Event('change'));
    systemDark = true;
    media.dispatchEvent(new Event('change'));
    expect(darkMode()).toBe(false);

    appearance.select(ThemePreference.System);
    expect(appearance.preference()).toBe(ThemePreference.System);
    expect(darkMode()).toBe(true);
    expect(localStorage.getItem(TUI_DARK_MODE_DEFAULT_KEY)).toBeNull();
  });

  it('restores an explicit saved preference', () => {
    localStorage.setItem(TUI_DARK_MODE_DEFAULT_KEY, 'true');
    const appearance = TestBed.inject(AppearanceService);
    expect(appearance.preference()).toBe(ThemePreference.Dark);
    expect(TestBed.inject(TUI_DARK_MODE)()).toBe(true);
  });
});
