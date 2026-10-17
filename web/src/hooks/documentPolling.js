export const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'ocr', 'chunking', 'embedding']);
export const TERMINAL_STATUSES = new Set(['ready', 'failed']);

export const POLL_DEFAULTS = {
  timeoutMs: 600_000,
  initialIntervalMs: 2_000,
  maxIntervalMs: 10_000,
  backoffRate: 1.5
};

export function hasProcessingDocuments(documents) {
  if (!Array.isArray(documents)) {
    return false;
  }

  return documents.some((document) => POLLING_STATUSES.has(document?.status));
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function mergeDocumentLists(localDocuments, liveDocuments) {
  const live = Array.isArray(liveDocuments) ? liveDocuments : [];

  if (!Array.isArray(localDocuments) || localDocuments.length === 0) {
    return live;
  }

  const liveIds = new Set(live.map((document) => document?.id));
  const pending = localDocuments.filter((document) => document && !liveIds.has(document.id));

  return [...pending, ...live];
}

export function nextPollPlan({ documents, elapsedMs, currentIntervalMs, options = {} }) {
  const { timeoutMs, maxIntervalMs, backoffRate } = { ...POLL_DEFAULTS, ...options };

  if (!hasProcessingDocuments(documents)) {
    return { stop: true, reason: 'terminal' };
  }

  if (Number.isFinite(elapsedMs) && elapsedMs >= timeoutMs) {
    return { stop: true, reason: 'timeout' };
  }

  const safeInterval = Number.isFinite(currentIntervalMs) && currentIntervalMs > 0
    ? currentIntervalMs
    : POLL_DEFAULTS.initialIntervalMs;

  return {
    stop: false,
    reason: 'processing',
    delayMs: safeInterval,
    nextIntervalMs: Math.min(Math.round(safeInterval * backoffRate), maxIntervalMs)
  };
}
