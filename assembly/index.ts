// Infrastructure smoke ONLY: an identity function compiled to real WebAssembly.
export function smoke(value: i32): i32 {
  return value;
}

// TODO: implement stateful market-update generation and randomness here in Wasm.
// No generator, prices, batches or metric calculations are implemented in this scaffold.
