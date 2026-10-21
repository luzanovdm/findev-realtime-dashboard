import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { TUI_DARK_MODE, TUI_DARK_MODE_KEY } from '@taiga-ui/core';

export enum ThemePreference {
  System = 'system',
  Light = 'light',
  Dark = 'dark',
}

const SAVED_PREFERENCES: Readonly<Record<string, ThemePreference>> = {
  true: ThemePreference.Dark,
  false: ThemePreference.Light,
};

interface StoredPreference {
  readonly preference: ThemePreference;
  readonly invalid: boolean;
}

function savedPreference(document: Document, key: string): StoredPreference {
  try {
    const storage = document.defaultView?.localStorage;
    const saved = storage?.getItem(key);
    if (!saved) return { preference: ThemePreference.System, invalid: false };
    const preference = SAVED_PREFERENCES[saved];
    if (preference) return { preference, invalid: false };
    storage?.removeItem(key);
    return { preference: ThemePreference.System, invalid: true };
  } catch {
    return { preference: ThemePreference.System, invalid: false };
  }
}

@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly storedPreference = savedPreference(inject(DOCUMENT), inject(TUI_DARK_MODE_KEY));
  private readonly darkMode = inject(TUI_DARK_MODE);
  private readonly apply = {
    [ThemePreference.System]: () => this.darkMode.reset(),
    [ThemePreference.Light]: () => this.darkMode.set(false),
    [ThemePreference.Dark]: () => this.darkMode.set(true),
  } satisfies Readonly<Record<ThemePreference, () => void>>;
  private readonly selection = signal(this.storedPreference.preference);

  readonly preference = this.selection.asReadonly();
  readonly choices = [
    { value: ThemePreference.System, label: 'System' },
    { value: ThemePreference.Light, label: 'Light' },
    { value: ThemePreference.Dark, label: 'Dark' },
  ] as const;

  constructor() {
    if (this.storedPreference.invalid) this.darkMode.reset();
  }

  select(preference: ThemePreference): void {
    this.apply[preference]();
    this.selection.set(preference);
  }
}
