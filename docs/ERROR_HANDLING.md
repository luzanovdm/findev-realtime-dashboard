# Producer Failure Policy

| Field               | Value                                            |
| ------------------- | ------------------------------------------------ |
| Status              | Accepted for implementation                      |
| Owner               | Market producer feature                          |
| Version             | 1.0                                              |
| Last reviewed       | 2026-10-21                                       |
| Requirement source  | [TASK.md](../TASK.md)                            |
| System architecture | [ARCHITECTURE.md](ARCHITECTURE.md)               |
| Delivery plan       | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |

Review this policy when a new producer failure mode appears, the worker protocol changes, or browser
runtime testing reveals a recovery path that can lose or misstate cumulative metrics.

## 1. Safety rule

The market data is simulated, but the dashboard must still make its trust state unambiguous. A failed
run never continues from an unknown point. A new run resets generator state, volume, and VWAP. The
application may keep a last confirmed snapshot visible only when it can prove that snapshot was
complete and validated. It must label that snapshot as stopped and stale, including its last update
time. If data integrity is uncertain, hide affected metrics.

Within the running application, errors must lead to a visible state and a usable navigation and
recovery control. The browser process, a killed tab, or a completely failed JavaScript bootstrap is
outside what application code can guarantee. An HTML fallback and global diagnostics can explain a
bootstrap failure where the browser still renders the document.

## 2. Severity and presentation

| Level              | Meaning                                                                                       | Producer action                                                                  | User presentation                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Validation         | A settings draft is incomplete or outside the task's integer ranges                           | Do not send Apply; existing run continues                                        | Field-level message; no global error banner                                          |
| Storage warning    | Accepted settings cannot be read from or saved to browser storage                             | Continue with defaults on load or run the valid Apply in memory                  | Nearby Apply status explains that settings will reset after reload                   |
| Warning            | Output remains correct, but requested speed or browser scheduling differs from observed speed | Continue; never replay missed intervals                                          | Nonblocking status note after sustained deviation                                    |
| Run error          | Generation cannot continue, but the last published snapshot is known valid                    | Cancel generation subscription; no automatic continuation of the same run        | Error banner, `Stopped` label and timestamp on retained rows, `Start new run` action |
| Integrity critical | Current-run protocol, ABI, market record, or metric state cannot be trusted                   | Stop before applying or publishing the suspect batch; quarantine current metrics | Error banner, unavailable metrics, `Start new run` action                            |

An unsupported Worker or WebAssembly runtime is a terminal environment error. The application shell
and settings route remain available; the message explains that market data cannot start in this
browser. Repeating Apply in the same unsupported runtime is not offered as a useful recovery.

`Pause` and `Resume` are unavailable in any error state. A valid `Apply` or `Start new run` creates a
higher `runId` and clears prior totals. It does not resume the failed run.

The worker reports slow delivery only after five consecutive completed-batch intervals exceed twice
the requested interval. Five consecutive timely intervals clear the warning. Pause and a new run
also clear it. The warning does not change the producer status or discard any generated trade.

## 3. Failure catalogue

The worker sends stable error codes, never raw exception text. The facade maps codes to fixed English
messages and user actions. Technical causes remain in development diagnostics and tests.

| Code                 | Level              | Last confirmed snapshot                                    | Recovery                                                                                                                                    |
| -------------------- | ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker-unavailable` | Environment error  | No current run data                                        | Use a supported browser/runtime                                                                                                             |
| `wasm-fetch`         | Run error          | Stale if the current run had published one                 | Retry as a new run; only transient network/HTTP 429/5xx loading failures receive up to two bounded automatic retries before the first batch |
| `wasm-instantiate`   | Run error          | Stale if confirmed                                         | New run after reload or corrected deployment                                                                                                |
| `worker-crash`       | Run error          | Stale if confirmed                                         | Terminate worker, construct a new worker for a new run                                                                                      |
| `worker-timeout`     | Run error          | Stale if confirmed                                         | Terminate unresponsive worker, construct a new worker for a new run                                                                         |
| `generation`         | Run error          | Stale only if the failed batch was never partially applied | New run                                                                                                                                     |
| `wasm-abi`           | Integrity critical | Hide current-run metrics                                   | New run after version mismatch is corrected                                                                                                 |
| `protocol`           | Integrity critical | Hide current-run metrics                                   | New run after invalid current-run message or state transition                                                                               |
| `invalid-update`     | Integrity critical | Hide current-run metrics                                   | New run after invalid Wasm record                                                                                                           |
| `metric-failure`     | Integrity critical | Hide current-run metrics                                   | New run after failed Decimal calculation or accumulator invariant                                                                           |

The catalogue is deliberately finite. Unknown codes and malformed error events are classified as
`protocol`; they must not be rendered as user-facing text.

## 4. Boundary handling

### Settings and Angular

- Validate every configured setting before sending Apply. Empty, non-number, non-finite, fractional, and
  out-of-range values stay in the draft with a specific field error.
- Treat malformed stored data and storage-access exceptions as recoverable preference failures.
  Neither may stop the worker or the interface. Save failure is visible after a successful Apply.
- Facade methods guard allowed state and catch synchronous `Worker` construction and `postMessage`
  failures. Worker error and message-error events are converted into a current-run failure.
- The facade accepts only validated events for its current `runId`. Older run events are discarded
  without changing state. A malformed event that purports to belong to the current run stops it.
- A global Angular error handler and unhandled-rejection listener are a diagnostic fallback. They do
  not authorize continued generation after a failed producer command or corrupted metric state. The
  shell shows fixed recovery copy and a full-reload link without exposing exception details.

### Wasm loading and execution

A static host may return the SPA HTML fallback with HTTP 200 for a missing `.wasm` URL. The loader
checks a supplied response content type before instantiation and treats HTML as a non-retryable
`wasm-fetch` failure.

- Fetch errors, non-success HTTP status, compilation errors, missing exports, ABI mismatch, traps,
  and invalid pointers have distinct classifications.
- The loader validates exports, memory, pointer alignment, record width, and bounds before reading.
- The worker checks all records in a batch before applying any of them. If record 7 of 1,000 is
  invalid, records 1–6 do not affect volume or VWAP.
- The worker catches every asynchronous command handler rejection and generator exception, stops
  scheduling, and publishes one typed failure event where messaging remains possible.
- If the worker itself crashes, the facade handles `error` or `messageerror`, terminates that worker,
  and enters error state. It never assumes the previous Wasm state survived.

### Scheduling and liveness

- Initialization and command acknowledgements have bounded deadlines. A timed-out worker is
  terminated, so a late response cannot revive the failed run.
- A running worker sends progress with snapshots. The facade detects a
  lack of progress while the tab is visible, with a grace period when visibility returns. Hidden-tab
  timer throttling alone is not an error.
- Pause unsubscribes from the next batch before acknowledgement. Resume starts after one full interval. A
  stopped run never catches up missed intervals.

## 5. Data trust and transitions

Snapshots carry `runId`, a monotonic snapshot sequence, and a worker-generated timestamp. A snapshot
is accepted only when its protocol and all rows validate. On acceptance the facade updates all rows
atomically and records the timestamp. It rejects duplicates, out-of-order sequences, zero-volume
rows with populated metrics, volume regressions, and a new sequence with no new trades. Snapshot
coalescing may skip sequence numbers by design; a gap alone is not evidence of a lost trade.

Before accumulation, each Wasm batch is validated in full. The accumulator is then updated
synchronously in the worker. Any thrown error during accumulation is an integrity-critical failure;
the worker does not publish a partially updated snapshot. A new run creates a new accumulator rather
than trying to repair an unknown cumulative total.

On Apply, the facade immediately clears metrics and increments `runId`. If the new run fails during
initialization, it shows unavailable metrics, not values from the previous run. On a run error after a
confirmed snapshot, rows remain visible only with a stopped/stale label. On an integrity-critical
error, metrics are hidden even if a prior snapshot existed, because the current-run trust boundary has
been violated.

## 6. User-facing copy and diagnostics

Every error view answers: what stopped, whether displayed data is current, and what action is
available. The messages are fixed English strings, for example:

- `wasm-fetch`: “Market data could not be loaded. Start a new run to try again.”
- `worker-crash`: “Market data stopped unexpectedly. The last displayed values are outdated. Start a
  new run.”
- `invalid-update`: “Market data failed validation. Values are unavailable. Start a new run.”
- `worker-unavailable`: “This browser cannot run the market producer.”

The UI never displays a stack trace, local file path, asset URL, raw exception message, or internal
numeric pointer. Development diagnostics record `code`, `runId`, lifecycle stage, the last accepted
snapshot sequence, and the underlying cause or expected/observed facts when available. Each failure
boundary emits at most one diagnostic per failed run; repeated timers or messages must not flood logs
or banners.

## 7. Required tests

| Boundary        | Failure cases                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Error catalogue | Every code has severity, data disposition, safe message, and recovery action; unknown code is rejected                                |
| Loader          | Network failure, 404, retryable 5xx, invalid Wasm, missing exports, wrong ABI, out-of-bounds pointer                                  |
| Worker          | Malformed command, Wasm trap, invalid record late in a batch, Decimal failure, double failure notification, timer cancellation        |
| Facade          | Worker constructor throw, `postMessage` throw, `error`, `messageerror`, timeout, old-run event, malformed current-run event, teardown |
| Data trust      | Atomic batch rejection, stale snapshot label, hidden metrics after integrity failure, reset after Apply                               |
| UI              | English error copy, action availability, keyboard access, `aria-live`, navigation remains usable                                      |
| Runtime         | Missing Wasm over HTTP, failed worker initialization, visible-tab liveness check, no false failure from a hidden tab                  |

Fault injection uses fake workers and a virtual RxJS scheduler. No test waits for a real production timeout. The
compiled-Wasm and production-worker integration tests remain separate evidence.
