import type {
  ProducerErrorCode,
  ProducerStatus,
  SerializedInstrumentMetricSnapshot,
} from '../market-producer.types';
import { isRecord } from '../../../shared/is-record';
import { financialDecimal, isDecimalString } from '../metrics/financial-decimal';
import { isProducerErrorCode } from '../producer-error';
import { isProducerSettings, PRODUCER_SETTING_CONSTRAINTS } from '../producer-settings';
import type { ProducerSettings } from '../producer-settings';

export interface StartRunCommand {
  readonly type: 'start-run';
  readonly runId: number;
  readonly settings: ProducerSettings;
  readonly seed: number;
  readonly wasmUrl: string;
}

export interface PauseCommand {
  readonly type: 'pause';
  readonly runId: number;
}

export interface ResumeCommand {
  readonly type: 'resume';
  readonly runId: number;
}

export interface DisposeCommand {
  readonly type: 'dispose';
  readonly runId: number;
}

export type ProducerWorkerCommand = StartRunCommand | PauseCommand | ResumeCommand | DisposeCommand;

export interface RunStartedEvent {
  readonly type: 'run-started';
  readonly runId: number;
  readonly activeSettings: ProducerSettings;
}

export interface SnapshotEvent {
  readonly type: 'snapshot';
  readonly runId: number;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly metrics: readonly SerializedInstrumentMetricSnapshot[];
}

export interface StatusChangedEvent {
  readonly type: 'status-changed';
  readonly runId: number;
  readonly status: ProducerStatus;
}

export interface RunErrorEvent {
  readonly type: 'run-error';
  readonly runId: number;
  readonly code: ProducerErrorCode;
}

export interface PaceChangedEvent {
  readonly type: 'pace-changed';
  readonly runId: number;
  readonly slow: boolean;
}

export type ProducerWorkerEvent =
  RunStartedEvent | SnapshotEvent | StatusChangedEvent | RunErrorEvent | PaceChangedEvent;

type RecordValue = Readonly<Record<string, unknown>>;
type ValueGuard = (value: unknown) => boolean;
type RecordGuard = (value: RecordValue) => boolean;
type FieldGuards = readonly (readonly [string, ValueGuard])[];

const START_FIELDS: FieldGuards = Object.entries({
  settings: isProducerSettings,
  seed: isSeed,
  wasmUrl: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
} satisfies Readonly<Record<'settings' | 'seed' | 'wasmUrl', ValueGuard>>);

const SNAPSHOT_FIELDS: FieldGuards = Object.entries({
  sequence: isRunId,
  timestampMs: (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  metrics: isMetricList,
} satisfies Readonly<Record<'sequence' | 'timestampMs' | 'metrics', ValueGuard>>);

const COMMAND_GUARDS = {
  'start-run': (value: RecordValue) => validFields(value, START_FIELDS),
  pause: () => true,
  resume: () => true,
  dispose: () => true,
} satisfies Readonly<Record<ProducerWorkerCommand['type'], RecordGuard>>;

const EVENT_GUARDS = {
  'run-started': (value: RecordValue) => isProducerSettings(value['activeSettings']),
  snapshot: (value: RecordValue) => validFields(value, SNAPSHOT_FIELDS),
  'status-changed': (value: RecordValue) => isProducerStatus(value['status']),
  'run-error': (value: RecordValue) => isProducerErrorCode(value['code']),
  'pace-changed': (value: RecordValue) => typeof value['slow'] === 'boolean',
} satisfies Readonly<Record<ProducerWorkerEvent['type'], RecordGuard>>;

const COMMAND_GUARDS_BY_TYPE: ReadonlyMap<string, RecordGuard> = new Map(
  Object.entries(COMMAND_GUARDS),
);
const EVENT_GUARDS_BY_TYPE: ReadonlyMap<string, RecordGuard> = new Map(
  Object.entries(EVENT_GUARDS),
);

export function isProducerWorkerCommand(value: unknown): value is ProducerWorkerCommand {
  return validMessage(value, COMMAND_GUARDS_BY_TYPE);
}

export function isProducerWorkerEvent(value: unknown): value is ProducerWorkerEvent {
  return validMessage(value, EVENT_GUARDS_BY_TYPE);
}

function validMessage(value: unknown, guards: ReadonlyMap<string, RecordGuard>): boolean {
  if (!isRecord(value) || !isRunId(value['runId'])) return false;
  const type = value['type'];
  return typeof type === 'string' && (guards.get(type)?.(value) ?? false);
}

function validFields(value: RecordValue, guards: FieldGuards): boolean {
  return guards.every(([field, guard]) => guard(value[field]));
}

function isInstrumentMetricSnapshot(value: unknown): value is SerializedInstrumentMetricSnapshot {
  if (!isRecord(value)) return false;
  return validFields(value, METRIC_FIELDS) && validMetricAvailability(value);
}

const METRIC_FIELDS: FieldGuards = Object.entries({
  instrument: isInstrumentSymbol,
  lastPriceCents: isNullablePositiveDecimal,
  spreadCents: isNullablePositiveDecimal,
  volume: (value: unknown) => typeof value === 'bigint' && value >= 0n,
  vwapCents: isNullablePositiveDecimal,
  imbalance: isNullableImbalance,
} satisfies Readonly<Record<keyof SerializedInstrumentMetricSnapshot, ValueGuard>>);

const TRADE_METRIC_FIELDS = ['lastPriceCents', 'spreadCents', 'vwapCents'] as const;

function validMetricAvailability(value: RecordValue): boolean {
  if (value['volume'] === 0n) {
    return (
      TRADE_METRIC_FIELDS.every((field) => value[field] === null) && value['imbalance'] === null
    );
  }
  return TRADE_METRIC_FIELDS.every((field) => value[field] !== null);
}

function isMetricList(value: unknown): value is readonly SerializedInstrumentMetricSnapshot[] {
  if (
    !Array.isArray(value) ||
    value.length > PRODUCER_SETTING_CONSTRAINTS.instrumentCount.maximum ||
    !value.every(isInstrumentMetricSnapshot)
  ) {
    return false;
  }

  return new Set(value.map((metric) => metric.instrument)).size === value.length;
}

function isInstrumentSymbol(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = /^ASSET-(\d{2})$/.exec(value);
  if (match === null) return false;

  const sequence = Number(match[1]);
  return sequence >= 1 && sequence <= PRODUCER_SETTING_CONSTRAINTS.instrumentCount.maximum;
}

function isProducerStatus(value: unknown): value is ProducerStatus {
  return value === 'initializing' || value === 'running' || value === 'paused' || value === 'error';
}

function isRunId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 0xffff_ffff;
}

function isNullablePositiveDecimal(value: unknown): boolean {
  if (value === null) return true;
  return isDecimalString(value) && financialDecimal(value).greaterThan(0);
}

function isNullableImbalance(value: unknown): boolean {
  if (value === null) return true;
  if (!isDecimalString(value)) return false;

  const imbalance = financialDecimal(value);
  return imbalance.greaterThanOrEqualTo(-1) && imbalance.lessThanOrEqualTo(1);
}
