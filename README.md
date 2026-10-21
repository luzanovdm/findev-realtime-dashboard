# Findev Realtime Dashboard Scaffold

**This is a starter project for completing the coding assignment, not a finished solution.**
The employer's original requirements are preserved in [TASK.md](TASK.md).

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

| Command                | Purpose                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run build:wasm`   | Compile AssemblyScript to `public/wasm/scaffold.wasm`                    |
| `npm run build`        | Compile Wasm, then create a production Angular build                     |
| `npm run watch`        | Compile Wasm, then run the Angular development build in watch mode       |
| `npm run test:unit`    | Run Angular/Vitest unit smoke tests in Node and jsdom                    |
| `npm run test:watch`   | Run unit tests in watch mode                                             |
| `npm run test:smoke`   | Run the production build and real Wasm/worker smoke tests over Node/HTTP |
| `npm test`             | Run unit smoke tests, then worker/Wasm smoke tests                       |
| `npm run format`       | Format the project with Prettier                                         |
| `npm run format:check` | Check project formatting                                                 |
| `npm run commit`       | Create a guided Conventional Commit                                      |
| `npm run audit`        | Check dependencies for high-severity vulnerabilities                     |
| `npm run check`        | Check formatting and run all available tests                             |
| `npm run clean`        | Remove generated `dist`, `.angular/cache`, and `public/wasm` files       |

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
and the pre-push hook runs the complete project check. GitHub Actions repeats the complete check and
dependency audit for pushes and pull requests. Dependabot checks npm and GitHub Actions updates
weekly.

## Prepared scaffold

- Angular standalone components with strict TypeScript and two lazy routes: `/dashboard` and
  `/settings`.
- Feature-first slices for the dashboard, settings, and market producer. Each feature owns its UI,
  contracts, and runtime code; the app shell contains only application composition and routing.
- Taiga UI with `provideTaiga`, `tui-root`, the standard theme, local Manrope fonts, local SVG
  icons, navigation buttons, and badges. The UI has no CDN dependencies.
- Empty pages with explicit TODO markers. Forms, tables, and producer controls are not implemented.
- Dashboard metrics, producer settings, and market updates are defined beside the feature that owns
  their behavior.
- `assembly/index.ts` contains a real Wasm smoke function, `smoke(i32): i32`, that returns its
  argument. It is not a market generator, randomness source, or metric calculator.
- `features/market-producer/producer.worker.ts` loads and executes Wasm inside a worker and returns
  explicit failures.
- `features/market-producer/scaffold-connection.ts` runs one short Angular → Worker → Wasm
  diagnostic when the app shell is created, logs the result, and terminates the worker. It does not
  start a producer or implement pause, resume, or reset state.
- EditorConfig, Prettier, and VS Code format-on-save settings with recommended extensions.

## Smoke-test flow

```text
App → ScaffoldConnection → production Web Worker → fetch Wasm → smoke(42) → response → terminate
```

Wasm is loaded and executed only in the worker. Its URL is resolved from `document.baseURI`, so it
respects the application's base href. Missing Web Worker support, network or compilation failures,
missing exports, and timeouts produce explicit diagnostic errors.

`tests/scaffold.test.mjs` executes the compiled `.wasm` and then the worker bundle produced by the
Angular production build in `node:worker_threads`. A small test adapter maps `postMessage` and
`addEventListener` to Node. The worker loads Wasm from a temporary HTTP server bound to
`127.0.0.1` on an available port. The test covers a successful response and an HTTP 404 response,
then closes the server and worker.

These tests prove compilation and transport in Node. They do not replace browser rendering or the
assignment's acceptance tests. Browser and end-to-end checks are not automated. `it.todo` cases in
the unit suite identify missing business-requirement coverage and do not count as passed tests.

## Remaining implementation

- Add a stateful market-update generator and randomness in Wasm, including the batch ABI and memory
  ownership.
- Calculate all metrics, cumulative volume, and VWAP, including unavailable values for zero
  denominators and display formatting.
- Build the form with integer and range validation, setting application, and new-run behavior.
- Implement one producer lifecycle with pause, resume, reset, stale-run rejection, and resource
  cleanup.
- Add the instrument table, real status and errors, and responsive behavior under higher update
  rates.
- Add meaningful unit tests for every requirement in section 4 of `TASK.md`.

The current AssemblyScript stub runtime uses a neutral function without allocations. The future
generator must define memory ownership, runtime behavior, and resource cleanup. TypeScript types do
not validate messages at runtime; the production protocol must handle that boundary explicitly.

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
