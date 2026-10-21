# Code Review

| Field           | Value                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Scope           | Implementation against [TASK.md](../TASK.md) and the [implementation plan](IMPLEMENTATION_PLAN.md) |
| Reviewed        | 2026-10-21                                                                                         |
| Source baseline | `fe1f737`, `1b8652c`, and `d10f1b6`                                                                |
| Verification    | [Local verification](VERIFICATION.md)                                                              |

## Requirement and boundary review

| Concern              | Finding                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature ownership    | `market-producer` owns settings rules, contracts, worker protocol, Wasm adapter, scheduler, and metrics. `settings` owns only the editable draft; `dashboard` owns presentation. The app shell composes routes and global recovery. No generic type-based `core` bucket or cross-feature import of worker internals remains. |
| Financial arithmetic | Wasm emits integer cents and positive integer quantities. The worker converts monetary values to `decimal.js`, folds cumulative notional with `Decimal`, and folds volume with `bigint`. VWAP and imbalance remain unrounded until display. No generated trade history is retained.                                          |
| Lifecycle            | A root-provided facade owns at most one active worker. `runId` separates replacements; `switchMap` cancels old loads and schedules. Pause cancels batch generation before acknowledgement; Resume waits a full interval. Apply starts a fresh running run, even from paused.                                                 |
| Error containment    | Typed boundaries classify load, ABI, generated-record, metric, protocol, crash, and timeout failures. The facade hides untrusted metrics, labels recoverable confirmed values stale, terminates a failed worker, and offers a new run where possible. Errors do not reach the user as raw exception text.                    |
| Interface            | The dashboard renders all five required metrics, unavailable values and zero volume initially, one row per instrument, status and Pause/Resume controls. The settings form validates integer ranges without changing an active run before Apply.                                                                             |
| Testability          | Pure settings and metric functions, a generator port, scheduler injection, a fake worker, and compiled-Wasm tests cover the required deterministic cases. Production-worker transport and real-browser behavior are checked separately.                                                                                      |

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
   successful acknowledgement.
4. Dashboard status text and control labels were scattered across a template switch and conditional
   expression. A typed status-to-presentation table now owns that static copy. The component retains
   a guarded click handler because it crosses from a user event into producer commands.
5. Slow delivery now has a bounded, nonblocking warning. Diagnostics include a stable code, run ID,
   lifecycle stage, and available cause or expected/observed facts without exposing those details in
   the interface. Repeated malformed commands cannot flood the same run with failure events.
6. Snapshot validation previously checked fields independently, so a higher-sequence message could
   reduce cumulative volume or pair zero volume with populated prices. The protocol now checks
   zero-volume field consistency. The facade rejects any volume regression and any new sequence
   without new trade volume, classifying either as an integrity-critical protocol error.

## Pattern and smell assessment

The remaining `switch` statements are on closed protocol/event unions: worker command decoding and
the facade's pure state reducer. They make legal transitions and exhaustive cases visible. Replacing
them with dynamic dispatch tables would spread validation and weaken type narrowing. Remaining
conditional expressions select nullable metric values, scheduling policy, or immutable projections;
they do not own hidden process state. Production scheduling and watchdogs use RxJS `timer`, `repeat`,
and `switchMap`; timer-based waits outside RxJS appear only in test and soak tooling.

The facade has imperative methods for browser-owned resources (`Worker`, `postMessage`, termination)
and user commands. Those are effect boundaries around the observable state reducer, not a second
state store. Worker transport validates values at runtime because TypeScript types disappear across
`postMessage` and the Wasm ABI. The accumulator and reducer are pure, while the Wasm instance alone
owns mutable generator state.

## Remaining limits and delivery gate

The production initial bundle was 494.83 kB, close to the configured 500 kB warning threshold.
The maximum-rate browser and worker measurements passed on the tested machine, but a different device
or future UI dependency growth may need another profile. Browser behavior has manual acceptance
evidence; an automated end-to-end suite is outside the assignment's required tests.

Phase 9 remains open: the private repository has no connected Cloudflare Pages project or live demo.
The local Pages emulator proves the packaged routes and Wasm MIME rule, but only a remote deployment
and a later push can prove automatic push-to-live behavior and interviewer access. GitHub Actions is
manual-only during implementation; the intended Pages deployment must still build on every push to
meet the assignment.
