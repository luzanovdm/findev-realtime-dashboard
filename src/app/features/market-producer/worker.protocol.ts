import type {
  ProducerErrorCode,
  ProducerStatus,
  SerializedInstrumentMetricSnapshot,
} from './market-producer.types';
import { financialDecimal, isDecimalString } from './financial-decimal';
import { isProducerErrorCode } from './producer-error';
import { isProducerSettings } from './producer-settings';
import type { ProducerSettings } from './producer-settings';

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

export type ProducerWorkerEvent =
  RunStartedEvent | SnapshotEvent | StatusChangedEvent | RunErrorEvent;

export function isProducerWorkerCommand(value: unknown): value is ProducerWorkerCommand {
  if (!isRecord(value) || !isRunId(value['runId'])) return false;

  switch (value['type']) {
    case 'start-run':
      return (
        isProducerSettings(value['settings']) &&
        isSeed(value['seed']) &&
        typeof value['wasmUrl'] === 'string' &&
        value['wasmUrl'].trim().length > 0
      );
    case 'pause':
    case 'resume':
    case 'dispose':
      return true;
    default:
      return false;
  }
}

export function isProducerWorkerEvent(value: unknown): value is ProducerWorkerEvent {
  if (!isRecord(value) || !isRunId(value['runId'])) return false;

  switch (value['type']) {
    case 'run-started':
      return isProducerSettings(value['activeSettings']);
    case 'snapshot':
      return (
        isRunId(value['sequence']) &&
        typeof value['timestampMs'] === 'number' &&
        Number.isSafeInteger(value['timestampMs']) &&
        value['timestampMs'] >= 0 &&
        isMetricList(value['metrics'])
      );
    case 'status-changed':
      return isProducerStatus(value['status']);
    case 'run-error':
      return isProducerErrorCode(value['code']);
    default:
      return false;
  }
}

function isInstrumentMetricSnapshot(value: unknown): value is SerializedInstrumentMetricSnapshot {
  if (!isRecord(value)) return false;

  return (
    isInstrumentSymbol(value['instrument']) &&
    isNullablePositiveDecimal(value['lastPriceCents']) &&
    isNullablePositiveDecimal(value['spreadCents']) &&
    typeof value['volume'] === 'bigint' &&
    value['volume'] >= 0n &&
    isNullablePositiveDecimal(value['vwapCents']) &&
    isNullableImbalance(value['imbalance'])
  );
}

function isMetricList(value: unknown): value is readonly SerializedInstrumentMetricSnapshot[] {
  if (!Array.isArray(value) || value.length > 50 || !value.every(isInstrumentMetricSnapshot)) {
    return false;
  }

  return new Set(value.map((metric) => metric.instrument)).size === value.length;
}

function isInstrumentSymbol(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = /^ASSET-(\d{2})$/.exec(value);
  if (match === null) return false;

  const sequence = Number(match[1]);
  return sequence >= 1 && sequence <= 50;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
