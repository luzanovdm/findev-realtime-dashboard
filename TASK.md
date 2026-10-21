# Senior Frontend Developer Task
## Realtime Fintech Dashboard

Build a small Angular application with two pages: a **live market dashboard** and **data-producer settings**.

Implement a WebAssembly library that generates simulated financial data and runs inside a Web Worker. Previous fintech experience is not required; the necessary definitions and examples are included below.

**Required:** Angular, TypeScript, a candidate-written Wasm library, a Web Worker, and unit tests. **Choose the Wasm language and toolchain yourself.** Supporting libraries are your choice.

AI assistance is allowed. You must understand, test, and be able to explain your implementation.

## 1. Dashboard page

Display a live table with one row per fictional financial instrument. An instrument is simply an asset identified by a symbol, such as `ALFA` or `BETA`.

Show these five metrics for each instrument:

| Metric | Meaning and calculation |
|---|---|
| Last traded price | The price in the instrument's latest generated trade. |
| Bid–ask spread | `askPrice − bidPrice`. The bid is an available buying price; the ask is an available selling price. |
| Trading volume | The sum of all generated trade quantities for this instrument since the current run started. |
| Volume-weighted average price (VWAP) | `sum(tradePrice × tradeQuantity) / sum(tradeQuantity)` since the current run started. Larger trades contribute more. |
| Order-book imbalance | `(bidQuantity − askQuantity) / (bidQuantity + askQuantity)`, using the latest available buying and selling quantities. |

Use cumulative volume and VWAP, **not rolling time windows**. Count every trade once; available bid/ask quantities do not contribute to trading volume.

Before any data arrives, show unavailable values and zero volume. Show an unavailable value when a formula's denominator is zero. Format prices as currency and imbalance as a value between −1 and +1.

Include a **Pause/Resume** control and a basic producer status. Pausing stops generation; resuming preserves current values and totals without generating data for the paused interval.

### Calculation example

An instrument receives two trades: 10 units at $100 and 30 units at $102.

- Last traded price: **$102**.
- Volume: **40 units**.
- VWAP: `(100 × 10 + 102 × 30) / 40 = $101.50`.

With a current bid of $101.96 and ask of $102, the spread is **$0.04**. With bid quantity 600 and ask quantity 400, imbalance is `(600 − 400) / (600 + 400) = 0.20`.

## 2. Settings page

Provide a validated form with three producer settings:

| Setting | Meaning | Default | Allowed range |
|---|---|---:|---:|
| Instrument count | Number of fictional instruments to generate data for. | 5 | 1–50 |
| Updates per batch | Total number of market updates in each generated batch. | 100 | 1–1,000 |
| Batch interval | Requested time between batches, in milliseconds. | 500 | 50–2,000 |

All settings must be integers. For example, 100 updates every 500 ms gives a nominal rate of **200 updates per second across all instruments**, not per instrument. An instrument may appear more than once in a batch.

Editing the form must not immediately affect the producer. An **Apply** action starts a new run with the new settings and clears the previous run's values and totals. This also starts generation when the previous run was paused.

The application starts with the defaults. Navigating between pages must preserve the active run and its running/paused state. Navigation must not create additional producers. Results from a previous run must not overwrite the new run's state.

Settings do not need to persist after a browser reload.

## 3. Wasm producer and worker

The Wasm library must generate **market updates**, not independently randomized dashboard metrics. Each update represents one simulated trade and a current bid/ask snapshot.

An illustrative update is:

```json
{
  "instrument": "ALFA",
  "priceCents": 10200,
  "tradeQuantity": 30,
  "bidCents": 10196,
  "askCents": 10200,
  "bidQuantity": 600,
  "askQuantity": 400
}
```

Here, `10200` means $102.00. This JSON describes the required information; you may choose a different transport format.

The generator must retain per-instrument state between calls and return batches of the requested size. Prices should evolve from previous values rather than being completely unrelated on every update. Keep prices positive, the bid below the ask, trade quantities positive, and book quantities nonnegative. For this simplified model, choose each trade price from that update's bid or ask.

Randomness and price-generation logic must actually run in Wasm. A TypeScript generator wrapped in a trivial Wasm call is not sufficient. No realistic exchange model or order-matching algorithm is required.

Load and execute the Wasm producer in a Web Worker. You decide where metric calculations live and how data moves between Wasm, the worker, and Angular.

Use integer cents for generated prices and round calculated prices only for display. Do not retain the complete event history. The interface may refresh less frequently than data is produced, but every generated trade must contribute to volume and VWAP.

Keep the interface usable as the generation rate increases. Show meaningful initialization errors and clean up producer resources when they are replaced or no longer needed. No formal benchmark report is required.

## 4. Unit tests — required

Include meaningful unit tests for:

- Metric calculations, including the worked example, zero denominators, and isolation between instruments.
- Settings validation and the reset behavior when settings are applied.
- Pause/resume behavior and rejection of results from a previous run.
- Generator behavior, including requested batch sizes and valid generated values.

Generator tests may use the source language's test framework or execute the compiled Wasm module. Use fixed inputs or controllable dependencies where needed; tests must not depend on long real-time waits.

End-to-end tests are not required.

## 5. Submission and deployment

1. **Create a GitHub repository.** Include the Angular application, Wasm source, tests, and a README with build, run, and test instructions. Keeping the development commit history is encouraged, rather than uploading only the final version.

2. **Set up automatic deployment.** Connect the repository to a hosting service of your choice, such as Cloudflare Pages, GitHub Pages, or Vercel. You may use free hosting or an existing paid service. Each push to the repository must automatically build and redeploy the application, without manual deployment steps.

3. **Provide links to the repository and live demo.** Ensure both are accessible to the interviewers.

4. **Be ready to discuss and modify the implementation.** During the interview, we will discuss your architectural decisions and may ask you to change or extend part of the application. **Automatic deployment is required** so that changes pushed during the interview are reflected in the live demo without a manual deployment process.
