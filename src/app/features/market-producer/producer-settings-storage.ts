import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { isProducerSettings } from './producer-settings';
import type { ProducerSettings } from './producer-settings';

const STORAGE_KEY = 'findev.producer-settings.v1';

@Injectable({ providedIn: 'root' })
export class ProducerSettingsStorage {
  private readonly document = inject(DOCUMENT);

  load(): ProducerSettings | null {
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isProducerSettings(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(settings: ProducerSettings): boolean {
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) return false;
      storage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }
}
