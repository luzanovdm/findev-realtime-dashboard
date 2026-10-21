# Implementation Plan

| Field               | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Status              | Ready for implementation                                              |
| Owner               | Repository maintainer                                                 |
| Version             | 1.0                                                                   |
| Last reviewed       | 2026-10-21                                                            |
| Requirement source  | [TASK.md](../TASK.md)                                                 |
| Architecture source | [ARCHITECTURE.md](ARCHITECTURE.md)                                    |
| Wasm decision       | [ADR-0001](decisions/0001-use-assemblyscript-for-market-generator.md) |
| Failure policy      | [ERROR_HANDLING.md](ERROR_HANDLING.md)                                |

This plan implements the assignment in reviewable vertical increments. Each phase ends with working
evidence and leaves the application in a coherent state. A phase is complete only when its listed
acceptance gate passes; creating the files alone is not completion.

## 1. Phase 0 — Architecture and technical risk closure

**Goal:** validate the decisions that would be expensive to change after UI work begins.

### Work

1. Treat [ARCHITECTURE.md](ARCHITECTURE.md) as the canonical owner of runtime boundaries, state,
   lifecycle, protocol, and performance budgets.
2. Use AssemblyScript according to
   [ADR-0001](decisions/0001-use-assemblyscript-for-market-generator.md): primitive exports, fixed
   linear-memory regions, deterministic PRNG, and no JSON or managed objects across the boundary.
3. Write a minimal ABI contract test against the compiled module before implementing the full market
   rules. Prove that the worker can validate `abiVersion`, `recordWidth`, exported memory, pointer
   alignment, and the maximum output range.
4. Confirm that `memory.data` can reserve fixed price-state and output regions with the current
   AssemblyScript 0.28.20 compiler. Inspect the emitted imports/exports and memory after repeated calls.
5. Retain `runtime: "stub"` only when no repeated-path heap growth is observed. Otherwise switch to
   `incremental`; do not invent a custom memory manager.
6. Select and document the exact PRNG and generator bounds:
   - nonzero 32-bit seed normalization;
   - minimum and maximum reference prices;
   - maximum spread, trade quantity, and book quantity;
   - clamp behavior at price boundaries.
7. Verify that `bigint` volume values survive worker structured cloning in the supported browser
   baseline. Keep all monetary and ratio values in `decimal.js`; serialize them as canonical decimal
   strings at the worker boundary and reconstruct `Decimal` instances in Angular.
8. Record a baseline production build size and confirm that the built worker can load Wasm over HTTP
   with `application/wasm`.

### Nuances to resolve explicitly

- AssemblyScript syntax resembles TypeScript but has different types, allocation, nullability, and
  standard-library behavior. Generator code must use Wasm types intentionally.
- The `stub` runtime never frees. Fixed memory is a design constraint, not a micro-optimization.
- WebAssembly memory is mutable and the batch buffer is overwritten on the next call. The worker must
  consume a batch before invoking Wasm again.
- Production entropy may originate in the host, but every random decision and price transition must
  happen in Wasm.
- A compile success does not prove that the generator is in Wasm. Compiled-module behavioral tests
  provide that evidence.
- Static hosting must serve a separate `.wasm` asset and the built worker must resolve it relative to
  the application's base URL.

### Acceptance gate

- The chosen language, alternatives, runtime, ABI, memory ownership, and failure fallback are written
  in the ADR and architecture document.
- A compiled-Wasm spike passes ABI and repeated-call checks at batch size 1,000.
- No unexplained imported random function or per-batch memory growth exists.
- The existing production worker smoke still passes after the ABI spike.

## 2. Phase 1 — Public contracts and settings rules

**Goal:** replace placeholder entity files with the feature's stable public language before adding
asynchronous behavior.

### Work

1. Define `ProducerSettings`, defaults, limits, and a pure validator in `market-producer` ownership.
   Keep the Settings route responsible only for the editable draft and presentation.
2. Define public `ProducerStatus`, Decimal-backed `InstrumentMetricSnapshot`, serialized worker metric
   contracts, and safe error types.
3. Define closed worker command and event unions carrying `runId`.
4. Add runtime type guards for every command and event. Reject unknown keys only where strictness adds
   safety; always reject invalid discriminants, values, and ranges.
5. Add the fixed error catalogue and typed failure mapping from
   [ERROR_HANDLING.md](ERROR_HANDLING.md). Worker events carry codes instead of raw exception text.
6. Generate stable display symbols from instrument indexes in one producer-owned function.
7. Remove scaffold names (`SmokeRequest`, `ScaffoldConnection`, `WasmScaffold`) as their real
   replacements land. Do not keep compatibility aliases.

### Tests

- Defaults are exactly 5 instruments, 100 updates per batch, and 500 ms.
- Inclusive range boundaries pass; out-of-range values, fractions, `NaN`, and infinities fail.
- Protocol guards reject malformed settings, unknown message types, invalid run IDs, and invalid
  snapshots.
- Symbol mapping is stable and unique for indexes 0 through 49.

### Acceptance gate

- One immutable settings definition drives form validation, worker validation, and defaults.
- Public feature imports do not expose worker instances, mutable signals, or Wasm exports.
- All contract tests pass without timers or a browser.

## 3. Phase 2 — Stateful AssemblyScript generator

**Goal:** implement the required data source completely inside Wasm.

### Work

1. Implement the versioned generator exports defined by the architecture. Keep the diagnostic
   `smoke` export only until the production worker replaces that handshake in Phase 3.
2. Reserve fixed memory for:
   - 50 per-instrument reference prices;
   - one 1,000-record output batch;
   - PRNG and initialized-instrument state.
3. Implement deterministic seed normalization and the selected 32-bit PRNG.
4. Implement `initialize` to validate the instrument count, reset state, seed the PRNG, and initialize
   positive starting prices.
5. Implement `generateBatch` to validate the requested size and write exactly that many records.
6. Preserve the selected instrument's evolved price between records and between calls.
7. Enforce all invariants before writing each record: valid index, positive prices, bid below ask,
   trade at bid or ask, positive trade quantity, and nonnegative book quantities.
8. Rename the artifact from `scaffold.wasm` to a product name such as `market-generator.wasm` and
   update build and clean scripts atomically.

### Tests

- The actual compiled module returns exactly the requested sizes for 1, representative middle values,
  and 1,000.
- Instrument counts 1 and 50 work.
- Every generated record satisfies all invariants across many deterministic batches.
- Identical seeds and settings produce identical sequences.
- Different seeds produce a different sequence.
- Consecutive calls continue state rather than restarting it.
- Reinitialization with the same seed resets to the same initial sequence.
- Invalid counts and batch sizes fail through the documented error contract.
- Repeated maximum batches do not grow memory unexpectedly.

### Acceptance gate

- Tests execute the emitted `.wasm`, not a TypeScript copy of generator logic.
- Inspection confirms there is no imported randomness function.
- The worker can decode the maximum batch without JSON or per-record Wasm calls.

## 4. Phase 3 — Worker loader, protocol, and scheduler

**Goal:** turn the worker into the sole owner of producer execution and timing.

### Work

1. Replace the scaffold loader with a Wasm adapter that:
   - fetches the asset;
   - instantiates it once per worker;
   - validates exports and ABI version;
   - validates returned pointer ranges;
   - decodes packed records;
   - classifies fetch, compile, ABI, trap, and invalid-record failures with stable codes.
2. Implement a controller with explicit `initializing`, `running`, `paused`, and `error` transitions.
3. Implement recursive one-shot scheduling. Schedule only after the current batch is decoded and
   accumulated.
4. On Pause, cancel the pending handle before publishing `paused`.
5. On Resume, wait one full configured interval and preserve Wasm and metric state.
6. On Apply, cancel the old timer, reset Wasm and metrics, publish the new `runId`, and produce the
   first batch immediately.
7. Check `runId` after Wasm fetch/instantiation and at every scheduled callback before publishing.
8. Validate each full batch before accumulator mutation, so a bad late record cannot partially change
   volume or VWAP.
9. Convert load, ABI, protocol, and generation failures to stable error codes and stop scheduling.
10. Add bounded retries only for transient load failures before the first batch; never silently resume
    a failed run.
11. Handle `dispose` idempotently.

### Tests

- Use a fake scheduler and fake Wasm adapter for controller state tests.
- Start produces one immediate batch and then schedules one future callback.
- Pause prevents generation after acknowledgement.
- Resume preserves totals and schedules after a full interval.
- Repeated Pause or Resume commands are idempotent or rejected according to the documented state
  table; tests lock the chosen behavior.
- Apply while running or paused cancels the old schedule, clears state, and runs under a higher
  `runId`.
- Late initialization, scheduled callbacks, and events from an old `runId` are discarded.
- A thrown adapter error publishes one typed error and leaves no scheduled callback.
- An invalid last record prevents the entire batch from reaching the accumulator.
- Tests contain no real waits.

### Acceptance gate

- Exactly one batch can be active at a time.
- There is no interval catch-up or queued burst after pause.
- Controller tests prove stale-run rejection on both asynchronous initialization and timer paths.

## 5. Phase 4 — Exact metric accumulation and snapshot coalescing

**Goal:** account for every decoded market update without retaining event history.

### Work

1. Implement a pure accumulator keyed by instrument index.
2. Store latest trade/quote fields and cumulative notional as `Decimal`; store cumulative volume as
   `bigint`.
3. Derive last price, spread, VWAP, and imbalance with explicit unavailable values.
4. Reset the accumulator only on a new run.
5. Integrate the accumulator into the worker before any snapshot throttling.
6. Add a presentation snapshot gate capped at 10 Hz. A pending snapshot may be replaced with a newer
   aggregate, while input updates are never skipped.
7. Emit immutable rows in stable instrument order.

### Tests

- The required 10 units at $100 plus 30 units at $102 example produces last price $102, volume 40,
  and VWAP $101.50.
- Bid $101.96, ask $102, quantities 600 and 400 produce spread $0.04 and imbalance 0.20.
- Zero trade volume produces unavailable VWAP.
- Zero bid-plus-ask quantity produces unavailable imbalance.
- Updates for one instrument do not change another instrument.
- Multiple occurrences of one instrument in one batch are all counted exactly once.
- A deterministic generated update count equals the sum of all instrument volumes when every test
  trade quantity is one.
- Snapshot coalescing reduces messages without changing final accumulated values.

### Acceptance gate

- The worker retains O(instrument count) state and no update history.
- Monetary calculations never convert through binary floating point; high-volume cumulative values
  remain exact within the configured Decimal precision.
- Maximum-rate input produces at most 10 UI snapshots per second under the fake clock.

## 6. Phase 5 — Application-scoped producer facade

**Goal:** expose one stable producer to both routes and make stale state impossible to render.

### Work

1. Implement a root-provided facade and inject it eagerly from the app composition root.
2. Construct exactly one module worker and resolve the Wasm URL from the document base URI.
3. Start the default run once during application initialization.
4. Expose readonly signals for status, active settings, metrics, current run, and error.
5. Implement `pause`, `resume`, and `apply` commands with allowed-state guards.
6. Clear visible rows immediately when Apply creates a new run.
7. Validate worker events and reject every noncurrent `runId` before updating signals.
8. Keep a last confirmed snapshot with a stopped/stale label for run errors; hide metrics after
   integrity-critical errors.
9. Handle worker `error`, `messageerror`, command timeout, and visible-tab liveness timeout. Terminate
   a failed worker before constructing another for a new run.
10. Terminate and detach the worker on application teardown.

### Tests

- A worker factory spy proves one worker for app lifetime and zero workers from route components.
- Defaults are sent once on startup.
- Navigation-equivalent component destruction does not terminate or restart the producer.
- Pause and Resume commands reflect allowed states.
- Apply increments `runId`, clears metrics, updates settings after worker acknowledgement, and resumes.
- Old `runId` snapshots and errors cannot overwrite the current state.
- A malformed current-run snapshot is rejected atomically and classified as a protocol failure.
- A dead worker cannot strand the UI in `initializing` or `running` indefinitely.
- Teardown removes handlers and terminates once.
- Unsupported Worker or WebAssembly produces a meaningful public error.

### Acceptance gate

- The dashboard and settings components can be destroyed and recreated while the same active run
  continues.
- Components depend only on facade methods and readonly state.

## 7. Phase 6 — Settings feature

**Goal:** provide a validated draft that changes production only through Apply.

### Work

1. Build the form with Angular Signal Forms and native numeric inputs.
2. Initialize all three draft fields from active settings.
3. Apply required, integer, and inclusive range validation from the canonical settings rules.
4. Show field-level errors after interaction and a concise form-level Apply failure if needed.
5. Keep edits local; never mutate active settings from input events.
6. Disable or block Apply while invalid or while the new run is initializing.
7. Submit a copied settings value to the facade.
8. After acknowledgement, reset draft, dirty, and submitted state to the accepted settings.
9. If active settings change while the form is pristine, refresh the draft. If the form is dirty,
   preserve the user's draft until Apply or route exit.

### Tests

- Defaults and all inclusive boundaries are accepted.
- Fractions, empty values, values outside ranges, `NaN`, and infinities are rejected.
- Editing does not send producer commands.
- Valid Apply sends one immutable settings snapshot.
- Apply resets prior metric state through the facade and starts a paused producer.
- Invalid submit sends nothing and exposes associated errors.
- Tests act, await `fixture.whenStable()`, and assert without manual change-detection workarounds.

### Acceptance gate

- The form behavior matches every row of the settings table in `TASK.md`.
- Active settings and draft settings have distinct ownership and cannot alias mutable objects.

## 8. Phase 7 — Dashboard feature

**Goal:** render accurate live metrics and controls without adding data-plane work to the main thread.

### Work

1. Render one semantic table row per active instrument in stable symbol order.
2. Show last price, spread, cumulative volume, VWAP, and imbalance.
3. Add pure display formatters:
   - Decimal cents to locale currency with two decimals using explicit decimal rounding;
   - `bigint` volume to grouped units;
   - imbalance to a fixed readable precision without escaping `[-1, 1]`;
   - `null` to an em dash.
4. Display zero volume and unavailable values before the first update.
5. Add a single Pause/Resume control whose label and enabled state derive from producer status.
6. Display initialization, running, paused, and error states and announce changes with `aria-live`.
7. Keep the final rows visible while paused or errored.
8. Use `OnPush`, stable row tracking, and no per-update main-thread subscriptions.
9. Add responsive table containment, visible focus, keyboard operation, and 200% zoom checks.

### Tests

- Initial rows show zero volume and unavailable derived values.
- Formatting rounds only the displayed price and preserves the underlying metric.
- Pause and Resume invoke the correct facade command once.
- Status, disabled states, and error text match facade state.
- A snapshot replaces displayed aggregates without recreating unrelated controls.
- Table headers and controls have accessible names and status changes are announced.

### Acceptance gate

- The worked example renders `$102.00`, `$0.04`, `40`, `$101.50`, and `0.20` under the fixed test
  locale.
- Maximum settings remain usable in a real browser with 50 rows.

## 9. Phase 8 — Integration, failure paths, and performance

**Goal:** prove that the real production bundles satisfy the boundaries tested in isolation.

### Work

1. Replace scaffold smoke tests with a production integration test that loads the real worker bundle
   and real market-generator Wasm over loopback HTTP.
2. Cover successful initialization, at least one decoded batch, pause/resume, Apply, and Wasm 404.
3. Keep deterministic Node tests where browser APIs map cleanly; use a manual browser matrix for real
   rendering and navigation behavior.
4. Run the maximum configuration and capture:
   - worker update accounting;
   - UI snapshot rate;
   - main-thread render duration;
   - memory trend for five minutes;
   - responsiveness of navigation and Pause.
5. Tune snapshot coalescing or row projection only if a documented budget fails.
6. Verify reloads of `/dashboard` and `/settings` in the production server configuration.
7. Verify missing/invalid Wasm, invalid ABI, malformed worker messages, and worker crashes surface
   meaningful errors and stop generation.
8. Verify that every failure path follows the severity, data display, action, and diagnostic rules
   in [ERROR_HANDLING.md](ERROR_HANDLING.md).

### Acceptance gate

- `npm run check` covers formatting, unit tests, compiled Wasm, worker integration, and production
  build from a clean checkout.
- No required test remains as `it.todo`.
- All budgets in the architecture are either met or revised with measured evidence and rationale.
- Manual acceptance evidence records browser, viewport, zoom, settings, result, and commit SHA.

## 10. Phase 9 — Automated deployment and submission readiness

**Goal:** publish the same tested artifact automatically and make the submission reproducible.

### Work

1. Choose Cloudflare Pages, GitHub Pages, or Vercel after a small deployment check confirms:
   - private-repository connection during development;
   - automatic deployment from pushes;
   - SPA route fallback;
   - correct `.wasm` MIME type;
   - stable public access for interviewers.
2. Configure CI to block deployment when the complete quality command fails.
3. Build once and publish the tested artifact rather than rebuilding with different inputs in an
   opaque deployment step where the provider permits it.
4. Add deployment concurrency so a superseded build cannot overwrite a newer successful deployment.
5. Document repository URL, live demo URL, Node/npm prerequisites, all commands, architecture links,
   known limits, and the selected hosting flow in `README.md`.
6. Make the repository public only when it and the live demo are ready for reviewer access.
7. Push a small visible change and verify that automatic deployment updates the live demo without a
   manual action.

### Acceptance gate

- Repository and demo links are accessible in a private/incognito browser session intended to model
  interviewer access.
- Direct navigation to both routes succeeds.
- The Wasm request returns HTTP 200 with `application/wasm`.
- The deployed UI generates live data, pauses, resumes, applies settings, and rejects stale results.
- A known commit SHA maps to the deployed version, and a later push redeploys automatically.

## 11. Requirement traceability

| Requirement                            | Primary implementation owner            | Primary evidence                              |
| -------------------------------------- | --------------------------------------- | --------------------------------------------- |
| Five live metrics per instrument       | Worker accumulator + Dashboard          | Pure metric tests + component rendering tests |
| Zero/unavailable semantics             | Accumulator + formatters                | Zero-denominator and initial-state tests      |
| Pause/Resume without catch-up          | Worker controller                       | Fake-scheduler state tests                    |
| Validated settings and Apply reset     | Settings + facade + worker              | Validation, command, and reset tests          |
| Route persistence and one producer     | Root facade                             | Worker-factory and route-lifecycle tests      |
| Reject previous-run results            | Worker + facade `runId` checks          | Late-init, timer, and event tests             |
| Stateful random market updates in Wasm | AssemblyScript module                   | Compiled-Wasm deterministic/invariant tests   |
| Worker execution                       | Worker loader/controller                | Production worker/Wasm HTTP integration test  |
| Every trade counted, no history        | Worker accumulator                      | Exact-count and bounded-state tests           |
| Responsive maximum rate                | Worker processing + snapshot coalescing | Fake-clock tests + browser profile            |
| Meaningful errors and cleanup          | Loader/controller/facade                | Failure-path and teardown tests               |
| Automated deployment                   | CI + static host                        | Deployment receipt and push-to-live check     |

## 12. Delivery sequence and commit shape

Use small Conventional Commits that leave checks green. A likely sequence is:

1. `docs(architecture): define producer and wasm boundaries`
2. `feat(producer): add validated runtime contracts`
3. `feat(wasm): generate stateful market batches`
4. `feat(producer): add worker lifecycle and scheduling`
5. `feat(metrics): accumulate market snapshots`
6. `feat(producer): expose application-scoped state`
7. `feat(settings): apply validated producer runs`
8. `feat(dashboard): render live market metrics`
9. `test(integration): verify built worker and wasm runtime`
10. `ci(deploy): publish the verified application`

Commit names are guidance, not a reason to split inseparable behavior. Generated Wasm output is kept or
ignored according to the final deployment build strategy, but source, build scripts, and tests always
land together.
