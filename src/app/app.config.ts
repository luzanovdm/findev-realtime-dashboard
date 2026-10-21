import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTaiga } from '@taiga-ui/core';
import { routes } from './app.routes';
import { AppErrorHandler } from './app-error';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useExisting: AppErrorHandler },
    provideRouter(routes),
    provideTaiga({ mode: 'light' }),
  ],
};
