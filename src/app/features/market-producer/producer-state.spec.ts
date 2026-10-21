import { INITIAL_PRODUCER_STATE, reduceProducerState } from './producer-state';
import type { ProducerState } from './producer-state';
import { DEFAULT_PRODUCER_SETTINGS } from './producer-settings';

function initializingState(): ProducerState {
  return reduceProducerState(INITIAL_PRODUCER_STATE, {
    type: 'begin',
    settings: DEFAULT_PRODUCER_SETTINGS,
  });
}

function runningState(): ProducerState {
  const initializing = initializingState();
  const acknowledged = reduceProducerState(initializing, {
    type: 'worker-event',
    event: {
      type: 'run-started',
      runId: initializing.runId,
      activeSettings: DEFAULT_PRODUCER_SETTINGS,
    },
  });
  return reduceProducerState(acknowledged, {
    type: 'worker-event',
    event: { type: 'status-changed', runId: initializing.runId, status: 'running' },
  });
}

describe('producer state transitions', () => {
  it('accepts acknowledged start, Pause, and Resume while clearing pending controls', () => {
    const running = runningState();
    expect(running.status).toBe('running');

    const pausing = reduceProducerState(running, { type: 'control', control: 'pause' });
    expect(pausing.pendingControl).toBe('pause');
    const paused = reduceProducerState(pausing, {
      type: 'worker-event',
      event: { type: 'status-changed', runId: running.runId, status: 'paused' },
    });
    expect(paused.status).toBe('paused');
    expect(paused.pendingControl).toBeNull();

    const resuming = reduceProducerState(paused, { type: 'control', control: 'resume' });
    const resumed = reduceProducerState(resuming, {
      type: 'worker-event',
      event: { type: 'status-changed', runId: running.runId, status: 'running' },
    });
    expect(resumed.status).toBe('running');
    expect(resumed.pendingControl).toBeNull();
  });

  it('treats premature and unsolicited status changes as integrity failures', () => {
    const initializing = initializingState();
    const premature = reduceProducerState(initializing, {
      type: 'worker-event',
      event: { type: 'status-changed', runId: initializing.runId, status: 'running' },
    });
    expect(premature.error?.code).toBe('protocol');

    const running = runningState();
    const unsolicited = reduceProducerState(running, {
      type: 'worker-event',
      event: { type: 'status-changed', runId: running.runId, status: 'paused' },
    });
    expect(unsolicited.error?.code).toBe('protocol');
    expect(unsolicited.metrics.every((metric) => metric.volume === 0n)).toBe(true);
  });

  it('allows a new run after a failure but ignores further events for the failed run', () => {
    const running = runningState();
    const failed = reduceProducerState(running, { type: 'failure', code: 'worker-crash' });
    const ignored = reduceProducerState(failed, {
      type: 'worker-event',
      event: { type: 'pace-changed', runId: running.runId, slow: true },
    });
    expect(ignored).toBe(failed);

    const restarted = reduceProducerState(failed, {
      type: 'begin',
      settings: DEFAULT_PRODUCER_SETTINGS,
    });
    expect(restarted.runId).toBe(running.runId + 1);
    expect(restarted.status).toBe('initializing');
    expect(restarted.error).toBeNull();
  });
});
