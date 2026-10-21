# Local Verification

This record separates source checks, compiled-module tests, production-worker tests, browser
observations, and remote hosting. The worker and soak results are from commit `fe1f737`; the later
dashboard presentation-only change is commit `1b8652c`; the snapshot-integrity fix is `d10f1b6`.
All passed the locked quality command on October 21, 2026. Native 200% zoom was verified on
`1b8652c`; the earlier headless-browser profile
used `e474e6b` before the controller change, so it is not a profile of the final code.
The follow-up settings and feature-structure revision has a separate local check below; the older
five-minute soak and native-zoom observations are not attributed to that revision.

| Layer                      | Environment and input                                                                       | Result                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install              | Node 24.21.0, npm 11.19.0, `npm ci`                                                         | Completed; npm reported zero vulnerabilities.                                                                                                                                                                                                                                   |
| Locked quality command     | `npm run check` after the snapshot-integrity change                                         | 143 Angular/Vitest tests, 8 compiled-Wasm and production-worker tests, formatting, and production build passed. No required test is skipped or marked TODO.                                                                                                                     |
| Dependency audit           | `npm run audit`                                                                             | Zero reported vulnerabilities.                                                                                                                                                                                                                                                  |
| Worker/Wasm integration    | Built worker and Wasm over loopback HTTP                                                    | Start, batch, Pause/Resume, Apply/reset, Wasm 404, invalid Wasm, and HTML SPA fallback covered. The Wasm response uses `application/wasm`.                                                                                                                                      |
| Five-minute soak           | Built worker, 50 instruments, 1,000 updates per batch, 50 ms requested interval, fixed seed | 5,440 batches and 5,440,000 updates; every final instrument volume matched deterministic compiled-Wasm replay. 2,720 running snapshots averaged 9.07 Hz; shortest worker-timestamp and observed-delivery intervals were both 102 ms. Pause acknowledgement took 4 ms.           |
| Worker heap                | Same soak, samples every 30 seconds                                                         | 11.1 MB at start, transient sampled peak 64.5 MB, 18.7 MB at five minutes. Samples fluctuated with collection and showed no sustained growth; this does not establish a universal heap ceiling.                                                                                 |
| Browser responsiveness     | Headless Chrome 155, 640 × 720 CSS px, 100% zoom, maximum settings, 10 seconds              | 50 rows; no `longtask` entries over 50 ms; p95 animation-frame spacing 16.7 ms. One measured Pause status update took 1.3 ms. Frame spacing is not render-duration profiling.                                                                                                   |
| Browser rendering trace    | Chrome DevTools Protocol, 50 rows, maximum settings, 100% zoom, 10 seconds                  | 91 Layout events totalled 68.4 ms (maximum 0.8 ms); 182 Paint events totalled 55.9 ms (maximum 0.4 ms); 182 PrePaint events totalled 16.3 ms (maximum 0.2 ms). These trace categories do not measure total Angular render duration.                                             |
| Native browser zoom        | Chrome on `1b8652c`, 200% page zoom, 836 CSS px viewport, maximum settings                  | The native zoom control reported 200%; 50 rows remained in the DOM, document `scrollWidth` equalled its 836 px viewport, and the metrics table remained contained. Zoom was restored to 100% afterward.                                                                         |
| Narrow layout              | Headless Chrome 155, 320 × 720 CSS px, 100% zoom, maximum settings                          | Document width stayed 320 px; the 755 px table scrolled inside a 286 px container. All 50 rows remained in the DOM.                                                                                                                                                             |
| Navigation and Pause       | Headless Chrome 155, maximum settings                                                       | The first row's volume remained `1,813,392` while paused for 250 ms and after Dashboard → Settings → Dashboard navigation; the status remained paused.                                                                                                                          |
| Unexpected interface error | Browser `ErrorEvent` injection and component test                                           | Fixed English recovery banner appeared without raw exception text; Reload cleared the error and restarted the dashboard.                                                                                                                                                        |
| Local Pages emulation      | Wrangler 4.151.3 serving the production output                                              | Direct GETs to `/dashboard` and `/settings` returned `200 text/html`; the Wasm asset returned `200 application/wasm`. Both routes rendered live values in Headless Chrome. A missing Wasm path returned `200 text/html` via SPA fallback and was classified as a fetch failure. |

The earlier settings and pipes revision passed `npm run check`: formatting; strict TypeScript checks for the app,
worker, and tests; 152 Angular/Vitest tests; eight compiled-Wasm and production-worker tests; and a
production build. `npm run audit` reported zero vulnerabilities. In Headless Chrome, Apply showed a
visible saved/live status, and a reload restored the values 50 / 1,000 / 50 and started a new running
run. The maximum-rate dashboard displayed 50 semantic rows without horizontal page overflow. A new
10-second foreground sample recorded zero `longtask` entries and 16.8 ms p95 animation-frame spacing
over 601 frames. This sample does not replace the older five-minute accounting soak or native 200%
zoom check.

The current protocol, state-transition, form, and purpose-named core layout passed `npm run check`: formatting, strict
application/worker/spec TypeScript checks, 156 Angular/Vitest tests, eight compiled-Wasm and
production-worker tests, and a production build. `npm run audit` reported zero vulnerabilities. The
initial bundle is 502.57 kB raw (117.51 kB estimated transfer), within the reviewed 510 kB warning
budget; the 1 MB error budget is unchanged. Before the source relocation, a five-minute
built-worker soak with 50 instruments, 1,000 updates per batch, and a requested 50 ms interval
processed 5,370 batches and accounted for all 5,370,000 updates against deterministic compiled-Wasm
replay. It emitted 2,685 running snapshots (8.95 Hz), with a shortest worker timestamp interval of
103 ms and a 7 ms Pause acknowledgement. Worker heap samples were 12.4 MB at the start, peaked at
44.3 MB, and were 25.2 MB at five minutes; they did not rise monotonically. This observation does not
prove the absence of all leaks. In a local browser, Apply showed saved/live feedback, the 50-row
dashboard displayed formatted currency, volume, and imbalance values, and a reload restored the
accepted 50 / 1,000 / 50 settings; no browser-console errors were observed. The later form teardown
and feedback-lifetime edits and the later source relocation were covered by unit tests and the final
locked quality command. After extracting the instrument-table component, the local browser applied
the maximum 50 / 1,000 / 50 settings, showed saved/live feedback, and rendered 50 rows with formatted
values. At a 320 px viewport, document width stayed 320 px while the 755 px table scrolled inside its
286 px region; the browser console recorded no errors. The earlier reload observation precedes the
form and source-layout edits; current storage and form behavior also passed unit tests.

The soak validates accounting for the number of batches actually generated. The requested 50 ms
interval is pacing between completed batches, so throughput may be below the nominal 20,000 updates
per second under host scheduling or worker processing load.

The route-service extraction passed `npm run check` on October 22, 2026: repository formatting,
strict application/worker/spec TypeScript checks, 156 Angular/Vitest tests, eight compiled-Wasm and
production-worker tests, and the production build. The Settings component tests cover draft
preservation, validation, Apply feedback, and cancellation of a pending run outcome when its route is
destroyed. Dashboard component tests cover status, Pause/Resume, and retained values. This verification
does not replace the earlier browser and soak observations.

The English Intl formatting revision passed the same locked command: 156 Angular/Vitest tests,
eight compiled-Wasm and production-worker tests, and the production build. Tests include exact
formatting above `Number.MAX_SAFE_INTEGER` for both Decimal currency values and `bigint` counts.

The browser observations are local acceptance evidence, not a claim about every device or deployed
host. The GitHub repository remains private. Cloudflare Pages has no GitHub connection or Pages
project for this repository yet. Remote route refreshes, Wasm response headers, a public demo, and
automatic push-to-live deployment remain unverified. The local Pages emulator confirms packaging and
routing rules only.
