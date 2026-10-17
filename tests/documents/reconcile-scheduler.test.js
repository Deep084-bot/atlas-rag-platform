import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startReconcileScheduler } from '../../server/documents/reconcileScheduler.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createTimerHarness() {
  let callback = null;
  let cleared = false;

  return {
    setIntervalFn: (fn) => {
      callback = fn;
      return { id: 'timer' };
    },
    clearIntervalFn: () => {
      cleared = true;
    },
    tick: () => {
      callback?.();
    },
    isCleared: () => cleared
  };
}

test('does not run on start when runOnStart is false but runs on tick', async () => {
  const harness = createTimerHarness();
  let calls = 0;

  const scheduler = startReconcileScheduler({
    pool: {},
    runOnStart: false,
    reconcile: async () => {
      calls += 1;
      return 1;
    },
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    logger: { error() {} }
  });

  assert.equal(calls, 0);

  harness.tick();
  await flush();
  assert.equal(calls, 1);

  scheduler.stop();
  assert.equal(harness.isCleared(), true);

  harness.tick();
  await flush();
  assert.equal(calls, 1);
});

test('runs immediately when runOnStart is true', async () => {
  const harness = createTimerHarness();
  let calls = 0;

  startReconcileScheduler({
    pool: {},
    runOnStart: true,
    reconcile: async () => {
      calls += 1;
      return 0;
    },
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    logger: { error() {} }
  });

  await flush();
  assert.equal(calls, 1);
});

test('does not overlap runs while one is in flight', async () => {
  const harness = createTimerHarness();
  let calls = 0;
  let release;

  const scheduler = startReconcileScheduler({
    pool: {},
    runOnStart: false,
    reconcile: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    logger: { error() {} }
  });

  harness.tick();
  await flush();
  assert.equal(calls, 1);

  harness.tick();
  await flush();
  assert.equal(calls, 1);

  release(0);
  await flush();

  harness.tick();
  await flush();
  assert.equal(calls, 2);

  scheduler.stop();
  release(0);
});

test('logs reconcile errors without throwing', async () => {
  const harness = createTimerHarness();
  const errors = [];

  const scheduler = startReconcileScheduler({
    pool: {},
    runOnStart: false,
    reconcile: async () => {
      throw new Error('boom');
    },
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    logger: { error: (message) => errors.push(message) }
  });

  harness.tick();
  await flush();

  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('boom'));

  scheduler.stop();
});

test('bounds long-running runs and stays usable afterwards', async () => {
  const harness = createTimerHarness();
  const errors = [];

  const scheduler = startReconcileScheduler({
    pool: {},
    runOnStart: false,
    runTimeoutMs: 10,
    reconcile: () => new Promise(() => {}),
    setIntervalFn: harness.setIntervalFn,
    clearIntervalFn: harness.clearIntervalFn,
    logger: { error: (message) => errors.push(message) }
  });

  harness.tick();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('exceeded'));

  scheduler.stop();
});
