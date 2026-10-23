# Findev Realtime Dashboard

Angular dashboard with a stateful AssemblyScript WebAssembly market generator running in a Web
Worker. The original assignment is in [TASK.md](TASK.md).

**Live demo:** https://findev-realtime-dashboard.pages.dev

[Public repository](https://github.com/luzanovdm/findev-realtime-dashboard). Cloudflare Pages builds
and publishes production from `main`; other branches receive preview deployments.

## Run and verify

Use Node **24.21.0** (`.nvmrc`) and npm **11.19.0**. The lockfile pins dependencies; no global Angular
CLI or Wasm SDK is needed.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4200/**. If that port is occupied, leave the existing process intact and use
`npm start -- --port 4300`. Stop with `Ctrl+C`.

| Command                              | Purpose                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `npm run check`                      | Formatting, lint, strict types, unit tests, production build, Wasm/worker tests     |
| `npm test`                           | 198 Angular/Vitest tests plus eight compiled-Wasm/worker tests and production build |
| `npm run test:unit`                  | Angular/Vitest tests only; `test:watch` enables watch mode                          |
| `npm run build`                      | Compile Wasm, then build production Angular assets                                  |
| `npm run build:wasm`                 | Compile `assembly/index.ts` to `public/wasm/market-generator.wasm`                  |
| `npm run perf:soak`                  | Five-minute maximum-rate production-worker/accounting check                         |
| `npm run audit`                      | Check dependencies for high-severity vulnerabilities                                |
| `npm run format`                     | Format with Prettier; `format:check` checks without editing                         |
| `npm run lint` / `npm run typecheck` | ESLint / strict app, worker, and spec TypeScript checks                             |
| `npm run clean`                      | Remove generated build, Angular cache, and Wasm files                               |

For verification from scratch: `npm ci && npm run clean && npm run check`.
Production output: `dist/findev-realtime-dashboard/browser/`.

Use npm scripts: calling `ng serve` or `ng build` directly skips Wasm compilation. After changing
AssemblyScript during development, run `npm run build:wasm` and reload; Angular watch mode does not
rebuild it. `npm run watch` starts an Angular development build in watch mode.

## Runtime behavior

```text
App → MarketProducerFacade → Web Worker → Wasm updates → Decimal metrics → Angular signals
```

- `/dashboard` shows last price, spread, cumulative volume, VWAP, and order-book imbalance. Values
  are unavailable before the first trade; volume starts at zero. Pause stops generation; Resume
  preserves state and waits one interval without catching up paused time.
- `/settings` validates integer ranges. Draft edits do not change the producer. Apply starts a new
  running run and clears previous metrics, including when the old run was paused.
- The root facade owns one worker across route navigation. `runId` and runtime protocol checks
  prevent previous-run results from replacing current data.
- Wasm owns the PRNG, per-instrument price walk, trade prices, quantities, and fixed batch buffer.
  Seven `i32` values encode each update; randomness and generation execute in Wasm.
- The worker accounts for every trade before coalescing snapshots to at most 10 Hz during generation.
  Prices/notional use `decimal.js`, volume uses `bigint`, and no complete event history is retained.
  Rounding happens only in display formatters.
- Accepted settings persist in this browser. Reload starts a fresh run using saved settings;
  malformed/unavailable storage falls back to defaults. Storage failure does not prevent Apply.
- Load, ABI, protocol, generation, and worker errors produce fixed recovery messages. Failed workers
  are terminated; confirmed stale values are labelled, while integrity failures hide values.

The UI uses Taiga UI with local fonts and icons. It has no CDN runtime dependencies. TypeScript,
Angular templates, and AssemblyScript have strict checks and feature-boundary lint.

## Design and development record

The plan and decisions are retained to show how the implementation evolved:

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): phased requirements, tests, and acceptance gates.
- [Architecture](docs/ARCHITECTURE.md): ownership, ABI, lifecycle, metrics, and performance budgets.
- [AssemblyScript decision](docs/decisions/0001-use-assemblyscript-for-market-generator.md): alternatives,
  fixed memory, and the non-collecting `stub` runtime constraint.
- [Failure policy](docs/ERROR_HANDLING.md): error classification, data trust, and recovery.
- [Review record](docs/CODE_REVIEW.md): resolved findings and remaining limits.
- [Verification](docs/VERIFICATION.md): test coverage and measured browser/worker evidence.

Compiled-module tests cover batch sizes, invariants, deterministic seeds, continuity, and fixed
memory. Production-worker tests cover startup, Pause/Resume, reset, missing/invalid Wasm, and HTML
fallback responses. Browser checks are separate from Node tests; E2E tests are not required.

Commits use Conventional Commits (`npm run commit` offers a prompt). Local hooks format/lint staged
files, validate messages, and run the full check before push. GitHub Actions runs push and pull-request checks, excluding documentation-only changes, and retains
manual dispatch. Dependabot checks npm and Actions weekly. Local hooks do not replace CI.

## Automatic deployment

Cloudflare Pages is connected through Git integration with access to this repository only. The first
production deployment passed the full check and published commit `1e7ee76` on 23 October 2026.
Both routes, live generation, Pause/Resume, and the Wasm response were checked on the hosted build.

The project uses these settings:

| Setting                       | Value                                    |
| ----------------------------- | ---------------------------------------- |
| Production branch             | `main`                                   |
| Root directory                | Repository root                          |
| Build command                 | `npm ci && npm run check`                |
| Output directory              | `dist/findev-realtime-dashboard/browser` |
| Environment                   | `SKIP_DEPENDENCY_INSTALL=1`              |
| Node version                  | `.nvmrc` (`24.21.0`)                     |
| Build watch include / exclude | `*` / none                               |

`check` builds the tested production artifact; Pages must publish that same output. Keep Pages builds
on every push, including documentation changes. GitHub CI's documentation filter is independent.
`public/_headers` supplies `application/wasm`. Pages' SPA fallback must serve direct `/dashboard` and
`/settings` requests.

The header displays the short source SHA and UTC build time (not release time), loaded without
blocking application startup. Metadata failures show a small unavailable label.

Builds generate `/build-info.json` with the source commit SHA and an ISO UTC build timestamp (`CF_PAGES_COMMIT_SHA` on Pages,
`GITHUB_SHA` on Actions, local Git HEAD otherwise). This generated file is ignored by Git and served
with `Cache-Control: no-store`. Compare it with the deployment's source commit to verify which
revision is live after a merge. It does not change application behavior.

Host configuration references:
[Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/),
[build image](https://developers.cloudflare.com/pages/configuration/build-image/),
[headers](https://developers.cloudflare.com/pages/configuration/headers/),
[SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/).
