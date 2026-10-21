// This protocol is ONLY an infrastructure smoke, not the task's producer protocol.
export interface SmokeRequest {
  readonly type: 'smoke';
  readonly wasmUrl: string;
}

export type SmokeResponse =
  | { readonly type: 'smoke-ok'; readonly value: number }
  | { readonly type: 'smoke-error'; readonly message: string };

// TODO: design typed producer commands/events and run identity yourself.
