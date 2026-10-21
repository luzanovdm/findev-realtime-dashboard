# ADR-0001: Use AssemblyScript for the market generator

| Field              | Value                                               |
| ------------------ | --------------------------------------------------- |
| Status             | Accepted                                            |
| Date               | 2026-10-21                                          |
| Owner              | Repository maintainer                               |
| Decision scope     | Wasm language, compiler, runtime, and host boundary |
| Requirement source | [TASK.md](../../TASK.md)                            |
| Architecture       | [ARCHITECTURE.md](../ARCHITECTURE.md)               |

Revisit this decision if the generator requires an ecosystem library unavailable to AssemblyScript,
the ABI grows beyond numeric batches, deterministic compiled-Wasm tests become impractical, or a
measured runtime limitation blocks the required throughput.

## Context

The assignment requires candidate-written WebAssembly that owns randomness, price generation, and
stateful market updates. It runs inside a Web Worker and exchanges up to 1,000 updates per batch with
TypeScript. The application team and surrounding code use TypeScript. The implementation must be easy
to explain and modify during an interview.

The hot path needs only integer arithmetic, fixed-capacity state for at most 50 instruments, a small
PRNG, and a 28 KB maximum output buffer. It does not need networking, files, threads, a standard C
library, rich host objects, or third-party numeric libraries.

## Decision drivers

1. Randomness and generator state must demonstrably execute in Wasm.
2. The build must be reproducible from the npm project without an undocumented global SDK.
3. The host boundary should avoid JSON, object binding, and per-update calls.
4. Compiled-Wasm tests must be deterministic and simple to run in CI.
5. The language should be understandable to an Angular/TypeScript reviewer while still exposing
   WebAssembly integer and memory semantics.
6. Toolchain and glue complexity should be proportional to a small numeric module.

## Considered options

| Criterion                   | AssemblyScript                                                       | Rust + `wasm-bindgen`                                                                 | C/C++ + Emscripten                                                           |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Team fit                    | Strong: TypeScript-like syntax                                       | Moderate: separate language and ownership model                                       | Moderate: separate language with manual memory safety                        |
| Local toolchain             | One pinned npm compiler                                              | Rust target, Cargo, and binding tooling                                               | Emscripten SDK with Clang/LLVM/Binaryen tooling                              |
| Primitive numeric ABI       | Direct exports and linear memory                                     | Direct ABI is possible; `wasm-bindgen` adds a post-processing/binding layer when used | Direct ABI is possible; Emscripten normally adds runtime/build configuration |
| Memory safety               | Bounds-checked language, but manual ABI validation remains necessary | Strongest compile-time guarantees                                                     | Manual memory management and the largest unsafe surface                      |
| Binary/runtime control      | Strong for a fixed low-level module                                  | Strong, with more build stages                                                        | Strong, with more configuration and runtime choices                          |
| Interview modification cost | Lowest for this repository                                           | Higher unless the reviewer already knows Rust                                         | Higher and less aligned with the application stack                           |
| Ecosystem depth             | Smaller Wasm-specific ecosystem                                      | Strong                                                                                | Very strong for existing C/C++ code                                          |

Rust would be preferred for a larger safety-critical numeric domain, shared native code, or a module
that benefits from its libraries and ownership guarantees. Emscripten would be preferred when porting
an existing C/C++ implementation. Neither advantage applies to this fixed-size generator.

## Decision

Use the locally pinned AssemblyScript compiler and keep the Wasm source in `assembly/`. Use explicit
`i32`/`u32` operations, fixed `memory.data` regions, exported linear memory, and a versioned primitive
ABI. Do not send strings, objects, managed arrays, or JSON across the Wasm boundary.

Use a documented deterministic 32-bit PRNG implemented in AssemblyScript. The worker supplies a seed;
it does not supply random values after initialization. A nonzero production seed comes from
`crypto.getRandomValues`, while tests use fixed seeds.

Retain the `stub` runtime only after confirming that `initialize` and `generateBatch` make no managed
heap allocations. Static state and the output buffer are allocated at compile time. If inspection or
the memory soak test shows runtime allocation, switch to the default incremental runtime rather than
building a custom allocator or relying on a non-collecting heap.

## Consequences

### Benefits

- The full toolchain remains pinned in `package-lock.json` and invoked by npm scripts.
- The source is approachable to the surrounding TypeScript team.
- A seven-`i32` record keeps the boundary inspectable and cheap.
- Fixed memory makes ownership and lifetime explicit and removes per-batch allocation pressure.
- Deterministic seeds allow the actual compiled module to be tested without time or network input.

### Costs and risks

- AssemblyScript is a TypeScript-like language, not TypeScript. Dynamic JavaScript features and many
  npm packages are unavailable.
- `stub` never collects garbage. Any accidental managed allocation in a repeated path would leak until
  the Wasm instance is replaced.
- The primitive ABI requires manual export, pointer, range, endianness, and record validation.
- AssemblyScript has a smaller ecosystem and contributor pool than Rust or C/C++.
- A source-language unit test alone could diverge from the emitted module, so generator acceptance
  tests must execute the compiled `.wasm` artifact.

## Guardrails

- Export `abiVersion` and `recordWidth`; reject mismatches before generation.
- Reserve all generator state and the maximum output buffer statically.
- Never cache a JavaScript memory view across possible `memory.grow`; the current design forbids growth
  after initialization and still creates the read view per batch.
- Decode records using explicit little-endian reads.
- Clamp prices below an overflow-safe maximum before deriving bid, ask, or notional inputs.
- Test at minimum batch sizes 1 and 1,000, instrument counts 1 and 50, repeated calls, fixed-seed
  reproducibility, state evolution, and every record invariant.
- Run a repeated-generation memory check before declaring the stub runtime verified.

## Evidence

- AssemblyScript compiles a statically typed TypeScript variant directly to WebAssembly and exposes
  low-level memory instructions:
  [AssemblyScript introduction](https://www.assemblyscript.org/introduction.html).
- AssemblyScript documents that the `stub` runtime never frees and recommends the default incremental
  runtime when the use case does not justify another variant:
  [AssemblyScript runtime](https://www.assemblyscript.org/runtime.html).
- WebAssembly linear memory is exposed to JavaScript as an `ArrayBuffer`, which supports this packed
  buffer boundary:
  [WebAssembly JavaScript API](https://webassembly.org/getting-started/js-api/).
- Rust's current binding guide shows the additional `wasm-bindgen` layer for rich JavaScript
  interoperability:
  [`wasm-bindgen` guide](https://wasm-bindgen.github.io/wasm-bindgen/).
- Emscripten compiles through LLVM's Wasm backend and its SDK includes a broader compiler toolchain:
  [building to WebAssembly](https://emscripten.org/docs/compiling/WebAssembly.html) and
  [Emscripten toolchain requirements](https://emscripten.org/docs/building_from_source/toolchain_what_is_needed.html).
