import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  reconcileStuckDocuments,
  PROCESSING_STATUSES
} from '../../server/documents/reconcileStuckDocuments.js';

function createFakePool({ rowCount = 0, rows = [] } = {}) {
  const calls = [];

  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rowCount, rows };
    }
  };
}

test('reconcile includes uploaded and all processing statuses', async () => {
  const pool = createFakePool({ rowCount: 0 });
  await reconcileStuckDocuments(pool, 30);

  assert.equal(pool.calls.length, 1);
  const { params } = pool.calls[0];

  assert.ok(params.includes('uploaded'));
  assert.ok(PROCESSING_STATUSES.every((status) => params.includes(status)));
  assert.equal(params[1], 30);
});

test('reconcile ages uploaded by created_at and processing by processing_started_at', async () => {
  const pool = createFakePool({ rowCount: 0 });
  await reconcileStuckDocuments(pool, 45);

  const { text } = pool.calls[0];

  assert.ok(/status\s*=\s*\$7[\s\S]*created_at\s*<[\s\S]*INTERVAL/.test(text));
  assert.ok(/processing_started_at\s*IS\s*NULL[\s\S]*processing_started_at\s*<[\s\S]*INTERVAL/.test(text));
});

test('reconcile returns the number of rows marked failed', async () => {
  const pool = createFakePool({
    rowCount: 2,
    rows: [
      { id: 'a', status: 'uploaded' },
      { id: 'b', status: 'embedding' }
    ]
  });

  const count = await reconcileStuckDocuments(pool, 30);
  assert.equal(count, 2);
});

test('reconcile tolerates zero affected rows', async () => {
  const pool = createFakePool({ rowCount: 0, rows: [] });
  const count = await reconcileStuckDocuments(pool, 30);
  assert.equal(count, 0);
});
