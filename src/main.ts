import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  const root = document.querySelector('app-root');
  if (!root) return;

  const message = document.createElement('p');
  message.className = 'startup';
  message.setAttribute('role', 'alert');
  message.append('Market dashboard could not start. ');
  const reload = document.createElement('a');
  reload.href = '/';
  reload.textContent = 'Reload the dashboard';
  message.append(reload, ' to try again.');
  root.replaceChildren(message);
});
