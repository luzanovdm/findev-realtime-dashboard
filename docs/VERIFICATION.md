# Local Verification

This record distinguishes source checks, the compiled Wasm and worker, browser observations, and
remote deployment. It reflects local `main` through the October 22, 2026 audit commits. The exact
source for each performance sample is identified below; samples from different revisions are not
silently combined.

## Current quality gate

`npm run check` passed after the producer batch-state change and expanded architectural lint:
Prettier, ESLint on Angular TypeScript, templates, and AssemblyScript, strict app/worker/spec
TypeScript checks, 192 Angular/Vitest tests, eight compiled-Wasm and production-worker smoke tests,
and the production build. The built worker test covers startup, Pause/Resume, reset, missing Wasm,
invalid Wasm, and an HTML SPA fallback. The compiled-module tests cover the ABI, batch sizes,
invariants, deterministic seeds, state continuity, and fixed Wasm memory. `npm run audit` reported
zero vulnerabilities.

The production initial bundle is 505.85 kB raw and 118.47 kB estimated transfer. Dashboard,
Settings, and the producer worker remain separate lazy chunks. The 510 kB warning and 1 MB error
budgets remain in force.

Architectural lint was also exercised against temporary in-memory violations. It rejected a core
import from a feature, route imports from another route or producer internals, producer imports from
a route, Angular imports in worker-side code, and an oversized AssemblyScript function. No probe
file was added to the repository.

## Maximum-rate worker soak

Both runs used the built worker and Wasm over loopback HTTP with 50 instruments, 1,000 updates per
batch, a requested 50 ms interval, and a fixed seed. Final instrument volumes matched a
deterministic compiled-Wasm replay for every generated update.

| Revision                                      | Batches and updates | Running snapshots | Snapshot rate | Shortest worker interval | Pause acknowledgement |
| --------------------------------------------- | ------------------- | ----------------- | ------------- | ------------------------ | --------------------- |
| Before batch-local metric staging (`2cd50bf`) | 5,451 / 5,451,000   | 2,728             | 9.09 Hz       | 102 ms                   | 11 ms                 |
| After batch-local metric staging (`ef4a47d`)  | 5,408 / 5,408,000   | 2,705             | 9.02 Hz       | 102 ms                   | 5 ms                  |

Each run lasted five minutes without a concurrent build. Throughput differed by about 0.8%; this
does not establish a speedup or slowdown. The changed code creates a batch-local state object once
per touched instrument instead of once per trade, while keeping the previous confirmed state
unchanged until the full batch succeeds.

Worker used-heap samples were collected every 30 seconds. The first run ranged from 12.4 MB at
startup to a transient sampled 52.8 MB and was 13.0 MB at minute 4.5. The second ranged from
10.6 MB to a transient sampled 42.7 MB and was 33.2 MB at minute 5. Both fluctuated with garbage
collection rather than rising monotonically. Sampling does not prove the absence of all leaks or
establish a reliable memory ceiling.

The requested interval is a delay between completed batches. The worker can therefore process
fewer than the nominal 20,000 updates per second under host scheduling and computation load; the
accounting assertion applies to the batches actually generated.

## Current browser acceptance

In local headed Chromium at 50 instruments, 1,000 updates per batch, and a 50 ms interval, the
dashboard rendered 50 semantic table rows. A ten-second foreground sample collected 1,200 animation
frames, with 9.2 ms p95 frame spacing and no `longtask` entry above 50 ms. The tested display ran
at approximately 120 Hz. Frame spacing and long-task entries do not measure total Angular render
duration or guarantee the same result on another device.

Pause showed the paused status within 36 ms of the browser automation action. The first row's values
stayed unchanged for a further 250 ms and after Dashboard → Settings → Dashboard navigation; Resume
remained available and all 50 rows remained present. The 36 ms includes automation and DOM waiting,
so it is not a worker-only latency measurement. The browser console recorded no errors.

In a separate current browser check, Apply showed “Saved in this browser. New run live.” for an
edited instrument count. Reload restored the accepted count. The theme's invalid-storage recovery
and System/Light/Dark selection have component and browser checks from their audit revisions;
route-scoped form teardown has a component test. Earlier narrow-width and native 200% zoom observations are
recorded in Git history; they were not repeated for this final code revision.

## Remote delivery

The GitHub repository is private. Cloudflare Pages has no GitHub connection or verified live demo
for this repository. Automatic push-to-live behavior, public access, remote route refreshes, and
remote Wasm response headers remain unverified. Cloudflare deployment and pushing are intentionally
deferred by the maintainer while code review continues. The local Pages emulator previously served
both direct routes and the Wasm asset with `application/wasm`; that does not substitute for a remote
deployment check.
