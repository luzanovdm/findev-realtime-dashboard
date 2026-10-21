import { ErrorHandler, Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppErrorHandler implements ErrorHandler {
  private readonly failedState = signal(false);
  readonly failed = this.failedState.asReadonly();

  handleError(error: unknown): void {
    this.failedState.set(true);
    console.error('Unexpected application error', error);
  }
}
