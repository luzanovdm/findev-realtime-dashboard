export interface ProducerSettings {
  readonly instrumentCount: number;
  readonly updatesPerBatch: number;
  readonly batchIntervalMs: number;
}

// TODO: implement defaults, integer/range validation, apply/reset and new-run behavior.
