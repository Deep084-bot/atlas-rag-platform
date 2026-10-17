import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasProcessingDocuments,
  isTerminalStatus,
  mergeDocumentLists,
  nextPollPlan,
  POLL_DEFAULTS
} from '../../web/src/hooks/documentPolling.js';

test('hasProcessingDocuments detects non-terminal ingest statuses', () => {
  assert.equal(hasProcessingDocuments([{ status: 'ready' }, { status: 'failed' }]), false);
  assert.equal(hasProcessingDocuments([{ status: 'uploaded' }]), true);
  assert.equal(hasProcessingDocuments([{ status: 'embedding' }]), true);
  assert.equal(hasProcessingDocuments(undefined), false);
});

test('isTerminalStatus recognizes ready and failed only', () => {
  assert.equal(isTerminalStatus('ready'), true);
  assert.equal(isTerminalStatus('failed'), true);
  assert.equal(isTerminalStatus('uploaded'), false);
});

test('mergeDocumentLists prefers live status over stale local copy', () => {
  const local = [{ id: 'a', status: 'uploaded', fileName: 'a.txt' }];
  const live = [{ id: 'a', status: 'ready', fileName: 'a.txt' }];

  const merged = mergeDocumentLists(local, live);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'ready');
});

test('mergeDocumentLists keeps locally uploaded documents not yet returned by the server', () => {
  const local = [{ id: 'new', status: 'uploaded' }];
  const live = [{ id: 'old', status: 'ready' }];

  const merged = mergeDocumentLists(local, live);
  assert.deepEqual(merged.map((d) => d.id), ['new', 'old']);
});

test('mergeDocumentLists returns live documents when there is no local state', () => {
  const live = [{ id: 'old', status: 'ready' }];
  assert.deepEqual(mergeDocumentLists(null, live), live);
  assert.deepEqual(mergeDocumentLists([], live), live);
});

test('nextPollPlan continues while documents are processing', () => {
  const plan = nextPollPlan({
    documents: [{ status: 'embedding' }],
    elapsedMs: 0,
    currentIntervalMs: POLL_DEFAULTS.initialIntervalMs
  });

  assert.equal(plan.stop, false);
  assert.equal(plan.delayMs, POLL_DEFAULTS.initialIntervalMs);
  assert.ok(plan.nextIntervalMs > plan.delayMs);
});

test('nextPollPlan stops when all documents are terminal', () => {
  const plan = nextPollPlan({
    documents: [{ status: 'ready' }],
    elapsedMs: 0,
    currentIntervalMs: POLL_DEFAULTS.initialIntervalMs
  });

  assert.equal(plan.stop, true);
  assert.equal(plan.reason, 'terminal');
});

test('nextPollPlan stops after the polling timeout', () => {
  const plan = nextPollPlan({
    documents: [{ status: 'embedding' }],
    elapsedMs: POLL_DEFAULTS.timeoutMs,
    currentIntervalMs: POLL_DEFAULTS.initialIntervalMs
  });

  assert.equal(plan.stop, true);
  assert.equal(plan.reason, 'timeout');
});

test('nextPollPlan caps the backoff at the maximum interval', () => {
  const plan = nextPollPlan({
    documents: [{ status: 'embedding' }],
    elapsedMs: 0,
    currentIntervalMs: POLL_DEFAULTS.maxIntervalMs
  });

  assert.equal(plan.nextIntervalMs, POLL_DEFAULTS.maxIntervalMs);
});
