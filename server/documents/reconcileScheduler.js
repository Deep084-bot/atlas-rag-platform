import { reconcileStuckDocuments } from './reconcileStuckDocuments.js';

export const DEFAULT_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_RECONCILE_RUN_TIMEOUT_MS = 60 * 1000;

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer = null;

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`reconcile run exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function startReconcileScheduler({
  pool,
  intervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  timeoutMinutes = 30,
  runTimeoutMs = DEFAULT_RECONCILE_RUN_TIMEOUT_MS,
  runOnStart = true,
  reconcile = reconcileStuckDocuments,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  let inFlight = false;
  let stopped = false;
  let timer = null;

  async function runNow() {
    if (stopped || inFlight || !pool) {
      return 0;
    }

    inFlight = true;

    try {
      return await withTimeout(reconcile(pool, timeoutMinutes), runTimeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.(`[reconcile] Failed: ${message}`);
      return 0;
    } finally {
      inFlight = false;
    }
  }

  function tick() {
    void runNow();
  }

  if (runOnStart) {
    void runNow();
  }

  timer = setIntervalFn(tick, intervalMs);

  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    runNow,
    stop() {
      stopped = true;

      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
    }
  };
}
