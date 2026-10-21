# Findev Realtime Dashboard

**The coding assignment is in progress.**
The employer's original requirements are preserved in [TASK.md](TASK.md).

## Architecture and implementation plan

- [Architecture](docs/ARCHITECTURE.md) defines feature ownership, runtime boundaries, the Wasm ABI,
  worker lifecycle, metric state, performance budgets, and verification strategy.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) turns every assignment requirement into phased
  work with tests and acceptance gates.
- [ADR-0001](docs/decisions/0001-use-assemblyscript-for-market-generator.md) records the Wasm language,
  toolchain, runtime, memory, and interoperability decision.
- [Producer failure policy](docs/ERROR_HANDLING.md) defines severity, data trust, recovery, and
  user-visible errors.

## Environment and startup

Node.js and npm are required. The tested local environment is Node **26.8.1** and npm
**11.19.0**. Compatible Node versions are listed in `package.json`; `.nvmrc` pins the tested
version. All dependencies are local, and `package-lock.json` provides reproducible installs.
Global Angular CLI, AssemblyScript, Rust, and other SDK installations are not required.

```sh
cd findev-realtime-dashboard
npm ci
npm start
```

Development URL: **http://127.0.0.1:4200/**. The browser does not open automatically.
Stop the server with `Ctrl+C`. If the port is already in use, leave the existing process intact
and use another port: `npm start -- --port 4300`.

`npm start` and `npm run dev` compile Wasm before starting Angular. After changing
`assembly/index.ts`, run `npm run build:wasm` and reload the page because Angular watch mode does
not rebuild AssemblyScript automatically.

## Commands

| Command                | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run build:wasm`   | Compile AssemblyScript to `public/wasm/market-generator.wasm`        |
| `npm run build`        | Compile Wasm, then create a production Angular build                 |
| `npm run watch`        | Compile Wasm, then run the Angular development build in watch mode   |
| `npm run test:unit`    | Run Angular/Vitest unit tests in Node and jsdom                      |
| `npm run test:watch`   | Run unit tests in watch mode                                         |
| `npm run test:smoke`   | Run the production build, compiled generator, and worker smoke tests |
| `npm test`             | Run unit tests, then compiled Wasm and worker tests                  |
| `npm run format`       | Format the project with Prettier                                     |
| `npm run format:check` | Check project formatting                                             |
| `npm run commit`       | Create a guided Conventional Commit                                  |
| `npm run audit`        | Check dependencies for high-severity vulnerabilities                 |
| `npm run check`        | Check formatting and run all available tests                         |
| `npm run clean`        | Remove generated `dist`, `.angular/cache`, and `public/wasm` files   |

Clean verification from scratch:

```sh
npm ci
npm run clean
npm run check
```

The build output is written to `dist/findev-realtime-dashboard/browser/`. Running `ng build` or
`ng serve` directly bypasses the npm hooks that compile Wasm, so use the npm commands above.

## Commit workflow

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/). Use
`npm run commit` for the guided prompt or write a message directly, for example:

```text
feat(dashboard): add cumulative volume metrics
```

The pre-commit hook formats staged files with Prettier, the commit-msg hook validates the message,
and the pre-push hook runs the complete project check. The GitHub Actions quality workflow currently
runs only when manually dispatched. Automatic triggers will return before submission, excluding
documentation-only changes. Dependabot checks npm and GitHub Actions updates weekly.

## Implementation status

- Angular standalone components with strict TypeScript and two lazy routes: `/dashboard` and
  `/settings`.
- Feature-first slices for the dashboard, settings, and market producer. Each feature owns its UI,
  contracts, and runtime code; the app shell contains only application composition and routing.
- Taiga UI with `provideTaiga`, `tui-root`, the standard theme, local Manrope fonts, local SVG
  icons, navigation buttons, and badges. The UI has no CDN dependencies.
- Dashboard and settings pages still need their forms, table, and controls.
- Dashboard metrics, producer settings, and market updates are defined beside the feature that owns
  their behavior.
- `MetricAccumulator` calculates exact Decimal prices and VWAP, bigint cumulative volume, spread,
  and imbalance; it rejects a bad batch without changing the last confirmed totals.
- `assembly/index.ts` contains the stateful market-update generator. Its randomness, price walk,
  instrument selection, trades, and order-book quantities run in Wasm; compiled-module tests cover
  the ABI, batch sizes, invariants, deterministic seeds, state continuity, and memory stability.
- `features/market-producer/producer.worker.ts` runs the generator and Decimal metric accumulator
  through an application-run protocol. It validates batches, schedules generation, and reports typed
  failures.
- The application-scoped producer facade owns the worker across route navigation, rejects stale runs,
  and presents safe errors and recovery actions.
- EditorConfig, Prettier, and VS Code format-on-save settings with recommended extensions.

## Producer flow

```text
App → MarketProducerFacade → Web Worker → Wasm updates → Decimal metrics → validated snapshots
```

Wasm is loaded and executed only in the worker. Its URL is resolved from `document.baseURI`, so it
respects the application's base href. The facade maps worker, network, ABI, protocol, and generation
failures to fixed English messages, terminates failed workers, and offers a new run where recovery is
possible.

`tests/wasm-abi.test.mjs` and `tests/wasm-generator.test.mjs` execute the compiled module directly.
`tests/producer-worker.test.mjs` runs the production worker bundle with the compiled Wasm asset,
including a maximum-size batch, Pause/Resume, reset, and missing-asset failure.

These tests prove compilation and transport in Node. They do not replace browser rendering or the
assignment's acceptance tests. Browser and end-to-end checks are not automated. `it.todo` cases in
the unit suite identify missing business-requirement coverage and do not count as passed tests.

## Remaining implementation

- Build the form with integer and range validation, setting application, and new-run behavior.
- Add the instrument table, currency and imbalance formatting, Pause/Resume controls, and responsive
  behavior under higher update rates.
- Complete browser acceptance, performance and failure-path checks, and automatic deployment.

The AssemblyScript generator uses fixed memory and a non-collecting stub runtime; compiled-Wasm tests
check that repeated maximum-size generation does not grow memory. Worker commands and events are
validated at runtime before state changes.

## Versions and official references

Verified on October 21, 2026:

- Angular/CLI **22.2.3** and TypeScript **6.0.3**:
  [Angular compatibility](https://angular.dev/reference/versions). Angular 22 supports Node
  `^22.22.3 || ^24.15.0 || ^26.0.0` and TypeScript `>=6.0.0 <6.1.0`.
- Taiga UI **5.29.0**:
  [official setup](https://taiga-ui.dev/getting-started/) and
  [machine-readable setup guide](https://taiga-ui.dev/getting-started.md). The published
  `@taiga-ui/core@5.29.0` peer dependencies support Angular `>=19.0.0`; npm installed the compatible
  dependency set without `--force` or `--legacy-peer-deps`.
- AssemblyScript **0.28.20**:
  [Getting started](https://www.assemblyscript.org/getting-started.html). The npm package requires
  Node `>=20` and npm `>=10`. The compiler is installed locally and does not need a separate system
  toolchain.
- `decimal.js` **10.6.0**:
  [official repository](https://github.com/MikeMcl/decimal.js). Financial calculations use
  arbitrary-precision decimal arithmetic instead of binary floating point.
- [Angular Web Workers](https://angular.dev/ecosystem/web-workers) and
  [Angular Vitest](https://angular.dev/guide/testing).

`package.json` contains a narrow Vite **8.3.3** override under the Angular builder. This patch fixes
known `launch-editor` issues in the CLI's default Vite version. The setup was verified with a
production build and a development HTTP smoke test; `npm audit` reported no vulnerabilities after
installation.

The lockfile pins exact package versions. Run `npm ls --depth=0` to inspect the installed set.

## Publishing status

The GitHub repository is private. Hosting, automatic deployment, and deployment secrets are not
configured yet. Section 5 of `TASK.md` describes the employer's submission requirements. When
publishing, configure the SPA host to return `index.html` for application routes.
