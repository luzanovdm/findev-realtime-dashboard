# Code Review

| Field           | Value                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Scope           | Implementation against [TASK.md](../TASK.md) and the [implementation plan](IMPLEMENTATION_PLAN.md) |
| Reviewed        | 2026-10-22                                                                                         |
| Source baseline | `e9949b5`, including the audit fixes and architectural lint                                        |
| Verification    | [Local verification](VERIFICATION.md)                                                              |

## Requirement and boundary review

| Concern              | Finding                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature ownership    | `market-producer` owns settings rules, contracts, worker protocol, Wasm adapter, scheduler, and market metrics. `settings` owns the editable draft; `dashboard/instrument-table` owns table-specific presentation. Purpose-named `core/money`, `core/numbers`, and `core/validation` own application-wide primitives. No feature imports worker internals across boundaries. |
| Financial arithmetic | Wasm emits integer cents and positive integer quantities. The worker converts monetary values to `decimal.js`, folds cumulative notional with `Decimal`, and folds volume with `bigint`. VWAP and imbalance remain unrounded until display. No generated trade history is retained.                                                                                          |
| Lifecycle            | A root-provided facade owns at most one active worker. `runId` separates replacements; `switchMap` cancels old loads and schedules. Pause cancels batch generation before acknowledgement; Resume waits a full interval. Apply starts a fresh running run, even from paused.                                                                                                 |
| Error containment    | Typed boundaries classify load, ABI, generated-record, metric, protocol, crash, and timeout failures. The facade hides untrusted metrics, labels recoverable confirmed values stale, terminates a failed worker, and offers a new run where possible. Errors do not reach the user as raw exception text.                                                                    |
| Interface            | The dashboard renders all five required metrics, unavailable values and zero volume initially, one row per instrument, status and Pause/Resume controls. The settings form validates integer ranges without changing an active run before Apply.                                                                                                                             |
| Testability          | Pure settings and metric functions, a generator port, scheduler injection, a fake worker, and compiled-Wasm tests cover the required deterministic cases. Production-worker transport and real-browser behavior are checked separately.                                                                                                                                      |

## Material findings resolved

1. The previous accumulator class mutated state inside an RxJS `scan`. A later invalid record could
   make rollback hard to reason about. The accumulator now returns a new state only after every
   record and Decimal operation in the batch succeeds. Tests inject both an invalid late record and
   a failing Decimal operation and verify the prior state remains intact.
2. The controller previously fanned the mode stream into `merge(modes, batches)`. Pause status
   delivery depended on subscriber order relative to cancellation of the batch subscription. One
   `switchMap` now owns the mode and its batch stream; replacement cancels the old generation stream
   before emitting the new mode. Virtual-scheduler tests cover Pause, Resume, Apply, and no catch-up.
3. The settings form previously mirrored active settings through an effect. `linkedSignal` now
   derives the draft from accepted settings while preserving locally edited values. Apply waits for
   the current run's `running` or `error` outcome and resets form interaction state only after a
   successful acknowledgement. `FormRoot` owns submission, dirty/touched state, and auto-clearing
   submission errors; reading `form().dirty()` from the linked draft would create a signal cycle.
4. Dashboard status text and control labels were scattered across a template switch and conditional
   expression. A typed status-to-presentation table now owns that static copy. The route-scoped
   dashboard service handles the guarded Pause/Resume command; the component only binds its view.
   Pure Angular pipes expose the Decimal and `bigint` formatters to the dashboard template.
5. Slow delivery now has a bounded, nonblocking warning. Diagnostics include a stable code, run ID,
   lifecycle stage, and available cause or expected/observed facts without exposing those details in
   the interface. Repeated malformed commands cannot flood the same run with failure events.
6. Snapshot validation previously checked fields independently, so a higher-sequence message could
   reduce cumulative volume or pair zero volume with populated prices. The protocol now checks
   zero-volume field consistency. The facade rejects any volume regression and any new sequence
   without new trade volume, classifying either as an integrity-critical protocol error.

## Pattern and smell assessment

Worker protocol guards are keyed by the closed command and event discriminants; each message field is
checked by a typed rule registry. The controller routes command transitions to RxJS streams and
reduces active-mode changes through pure state transformations. The facade now delegates to a pure
`producer-state` reducer. Exhaustive `ts-pattern` matching narrows actions and worker events without
casts, while a status-transition table records the legal lifecycle edges. Snapshot acceptance rules
name each invariant instead of embedding them in one compound conditional. The remaining conditionals
select nullable values or guard effect boundaries; they do not form a second state machine.
Production scheduling and watchdogs use RxJS `timer`, `repeat`, and `switchMap`; timer-based waits
outside RxJS appear only in test and soak tooling.

The facade has imperative methods for browser-owned resources (`Worker`, `postMessage`, termination)
and user commands. Those are effect boundaries around the observable state reducer, not a second
state store. Worker transport validates values at runtime because TypeScript types disappear across
`postMessage` and the Wasm ABI. The accumulator and reducer are pure, while the Wasm instance alone
owns mutable generator state. The accumulator evaluates declarative field rules with a short-circuit
loop because it validates every generated trade at up to 20,000 updates per second.

## Follow-up review: settings, strictness, and feature cohesion

| Finding                                            | Change and verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apply gave no completion feedback                  | The form now shows a pending label and disables repeated submission. Once the worker acknowledges a running run, a nearby `role="status"` message confirms both the live run and whether browser storage succeeded. A failed run keeps its draft and shows an actionable `role="alert"`. Success feedback is tied to its run; if the draft changes while the run starts, the confirmation remains visible and explicitly says the current edits were not applied. It disappears if that run later fails. Component tests and a real-browser Apply confirm the states.                      |
| Reload discarded accepted settings                 | The producer now reads and validates a versioned `localStorage` value before initial startup and saves accepted values on Apply. Missing, malformed, or inaccessible storage falls back to defaults without crashing. Reload starts a fresh run with saved settings; volume, snapshot, and Pause state are not persisted. Storage, facade, and browser-reload checks cover this.                                                                                                                                                                                                           |
| Repeated field checks and hand-written comparisons | One constraints object defines the setting names, limits, and defaults. The draft form registers validators from those names, and draft/worker setting comparisons iterate the same keys. Typed construction of defaults and drafts still lists the three fields so adding a field produces a compile error where a complete value is required.                                                                                                                                                                                                                                            |
| Flat producer directory                            | `generation/` owns the worker protocol, controller, and Wasm adapter; `metrics/` owns market accumulation. Exact Decimal construction lives in `core/money` because both worker processing and Angular state reconstruction use it. The facade, public contracts, settings policy, and error policy stay at the feature root.                                                                                                                                                                                                                                                              |
| Unsafe assertions and weak checks                  | Production, worker, and test code are type-checked by the locked quality command. Production enables `strict`, `strictTemplates`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`. Indexing at the metric and snapshot boundaries now has explicit failure handling. Broad state and DOM assertions were replaced by typed initial states and runtime-checked test helpers. The remaining Decimal-string brand assertion follows canonical serialization, and `as const` preserves literal discriminants; `satisfies` cannot replace either without losing the intended type. |
| Duplicate object guards                            | Settings validation, metric ingress, and worker protocol use one `core/validation/is-record` guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Flat dashboard presentation files                  | USD cents formatting and its pipe live in `core/money`; reusable `bigint` count formatting and its pipe live in `core/numbers`. The instrument table owns its component, template, styles, and market-specific imbalance formatter and pipe. `Intl.NumberFormat('en-US')` replaces manual digit grouping while preserving exact Decimal strings and `bigint` values.                                                                                                                                                                                                                       |
| Pending form outcome subscription                  | The Settings route now cancels its wait for a run acknowledgement when destroyed. A component test checks that the observable has no remaining subscriber after route teardown.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Workflow logic in route components                 | `SettingsFormService` owns the Signal Form draft, validation registration, Apply outcome, and feedback. `DashboardService` owns status presentation and guarded producer commands. Both are provided by their route components, so local state and subscriptions end with the route. The components contain only view imports and service injection.                                                                                                                                                                                                                                       |

## Follow-up review: validation and stream termination

The Wasm adapter now names generator input rules in `generation/generator-contract.ts`, uses a
predicate for the aligned output slice, and checks generated records through named trade and quote
rules. Worker protocol and metrics reuse the domain-neutral safe-integer guards in
`core/validation/integer-range.ts`. Generator-specific limits remain in the producer feature; `core`
has no knowledge of instrument or batch settings. An invalid reinitialization clears the adapter's
prior initialized state before rejecting the input. AssemblyScript keeps its own named input guards
at the separate Wasm compilation boundary.

The controller owns and explicitly disposes its command subscription and subject. Disposal aborts a
pending load and cancels scheduled generation; unexpected stream exceptions produce a typed failure
when a run is known. A disconnected output channel also closes the controller. The Worker removes its
message listener when the controller stops. The facade's subscriptions use `takeUntilDestroyed`, and
its shared reducer uses reference-counted replay. Apply outcome waits complete on acknowledgement,
failure, replacement, timeout, or route destruction. Wasm fetch and instantiation have bounded waits.
Unit tests cover these termination paths and invalid generator records.

The table is capped at 50 rows by `TASK.md`. The current maximum-rate browser sample found no task
over 50 ms in ten seconds and rendered all 50 semantic rows without page-width overflow. Virtual
scrolling would remove offscreen rows from the native table and add a
scrolling dependency. It is not justified by the measured workload; revisit if the row limit or a
measured render cost rises. This decision does not claim every device will meet the same frame budget.

## Remaining limits and delivery gate

The production initial bundle is 505.85 kB raw and 118.47 kB estimated transfer size at `e9949b5`.
The initial warning budget is 510 kB; the 1 MB error budget is unchanged.
The maximum-rate browser and worker measurements passed on the tested machine, but a different device
or future UI dependency growth may need another profile. Browser behavior has manual acceptance
evidence; an automated end-to-end suite is outside the assignment's required tests.

The final audit bounded decimal payloads before parsing, reduced one Decimal allocation per Wasm
update by reusing the validated quote object, and split command routing from active-run state. A
later batch-local accumulator change creates at most one draft state per touched instrument in a
batch and publishes it only after all updates succeed. Two five-minute runs accounted for every
update, but their 0.8% throughput difference is too small to establish a speedup. The producer's
command stream still owns cancellation and typed failure delivery. The route test proves
producer state survives route teardown; all defined error codes now have exact policy assertions.
ESLint checks TypeScript, AssemblyScript, and templates, source size and complexity, core-to-feature direction,
cross-feature access to worker internals, and UI imports in worker-side code. It runs in both the
locked quality command and the staged-file hook. The latest local verification is recorded in
[Local verification](VERIFICATION.md).

Phase 9 remains open and deployment is deferred by the maintainer: the private repository has no
connected Cloudflare Pages project or live demo.
The local Pages emulator proves the packaged routes and Wasm MIME rule, but only a remote deployment
and a later push can prove automatic push-to-live behavior and interviewer access. GitHub Actions is
manual-only during implementation; the intended Pages deployment must still build on every push to
meet the assignment.
