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

function savedPreference(document: Document, key: string): ThemePreference {
  try {
    const saved = document.defaultView?.localStorage.getItem(key);
    return SAVED_PREFERENCES[saved ?? ''] ?? ThemePreference.System;
  } catch {
    return ThemePreference.System;
  }
}

@Injectable({ providedIn: 'root' })
export class AppearanceService {
  private readonly darkMode = inject(TUI_DARK_MODE);
  private readonly apply = {
    [ThemePreference.System]: () => this.darkMode.reset(),
    [ThemePreference.Light]: () => this.darkMode.set(false),
    [ThemePreference.Dark]: () => this.darkMode.set(true),
  } satisfies Readonly<Record<ThemePreference, () => void>>;
  private readonly selection = signal(savedPreference(inject(DOCUMENT), inject(TUI_DARK_MODE_KEY)));

  readonly preference = this.selection.asReadonly();
  readonly choices = [
    { value: ThemePreference.System, label: 'System' },
    { value: ThemePreference.Light, label: 'Light' },
    { value: ThemePreference.Dark, label: 'Dark' },
  ] as const;

  select(preference: ThemePreference): void {
    this.apply[preference]();
    this.selection.set(preference);
  }
}
