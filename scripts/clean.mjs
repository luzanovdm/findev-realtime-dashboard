import { rmSync } from 'node:fs';

// Only generated paths, resolved relative to this project, never another checkout.
for (const path of ['../dist', '../.angular/cache', '../public/wasm']) {
  rmSync(new URL(path, import.meta.url), { recursive: true, force: true });
}
