import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EmbeddingBackfillProgressRepository,
  RESUMABLE_STATUSES
} from '../../server/embeddings/embeddingBackfillProgressRepository.js';
import { DatabaseError, ValidationError } from '../../server/errors.js';

function createPool(handler = () => ({ rows: [] })) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params);
    }
  };
}

function progressRow(overrides = {}) {
  return {
    space_id: 'space-1',
    document_id: 'doc-1',
    status: 'in_progress',
    expected_chunk_count: 3,
    completed_chunk_count: 1,
    token_count: 10,
    tokens_available: true,
    attempts: 2,
    last_error: null,
    started_at: null,
    completed_at: null,
    created_at: null,
    updated_at: null,
    ...overrides
  };
}

test('markInProgress upserts the row and increments attempts', async () => {
  const pool = createPool(() => ({ rows: [progressRow()] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markInProgress({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3,
    completedChunkCount: 1
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /INSERT INTO embedding_backfill_progress/);
  assert.match(sql, /ON CONFLICT \(space_id, document_id\)/);
  assert.match(sql, /attempts = embedding_backfill_progress\.attempts \+ 1/);
  assert.deepEqual(params, ['space-1', 'doc-1', 3, 1, null]);
  assert.equal(record.status, 'in_progress');
  assert.equal(record.attempts, 2);
  assert.equal(record.tokenCount, 10);
  assert.equal(record.tokensAvailable, true);
});

test('updateProgressCounts updates only the counters', async () => {
  const pool = createPool(() => ({ rows: [progressRow()] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.updateProgressCounts({
    spaceId: 'space-1',
    documentId: 'doc-1',
    completedChunkCount: 2,
    tokenCount: 5,
    tokensAvailable: false
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /UPDATE embedding_backfill_progress/);
  assert.match(sql, /SET completed_chunk_count = \$3/);
  assert.deepEqual(params, ['space-1', 'doc-1', 2, 5, false]);
});

test('updateProgressCounts returns null when no row exists', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool(() => ({ rows: [] })));

  const result = await repo.updateProgressCounts({
    spaceId: 'space-1',
    documentId: 'doc-1',
    completedChunkCount: 1
  });

  assert.equal(result, null);
});

test('markCompleted upserts a completed row', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'completed', completed_chunk_count: 3 })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markCompleted({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3,
    completedChunkCount: 3,
    tokenCount: 12,
    tokensAvailable: true
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /INSERT INTO embedding_backfill_progress/);
  assert.match(sql, /'completed'/);
  assert.deepEqual(params, ['space-1', 'doc-1', 3, 3, 12, true, null]);
  assert.equal(record.status, 'completed');
});

test('markFailed records a sanitized failure against an existing row', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'failed', last_error: 'boom' })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markFailed({
    spaceId: 'space-1',
    documentId: 'doc-1',
    lastError: 'boom',
    completedChunkCount: 1
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /UPDATE embedding_backfill_progress/);
  assert.match(sql, /status = 'failed'/);
  assert.deepEqual(params, ['space-1', 'doc-1', 'boom', 1, 0, false]);
  assert.equal(record.lastError, 'boom');
});

test('getProgress returns null when there is no row', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool(() => ({ rows: [] })));

  assert.equal(await repo.getProgress('space-1', 'doc-1'), null);
});

test('listResumable defaults to the resumable statuses and respects the limit', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.listResumable('space-1', { limit: 50 });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /status = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(params, ['space-1', 50, [...RESUMABLE_STATUSES]]);
});

test('listResumable rejects a bad status', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  await assert.rejects(
    () => repo.listResumable('space-1', { statuses: ['nope'] }),
    ValidationError
  );
});

test('repositories validate ids and counters', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  await assert.rejects(
    () => repo.markInProgress({ spaceId: '', documentId: 'doc', expectedChunkCount: 1 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.markInProgress({ spaceId: 'space', documentId: 'doc', expectedChunkCount: -1 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.listResumable('', {}),
    ValidationError
  );
  await assert.rejects(
    () => repo.listResumable('space', { limit: 0 }),
    ValidationError
  );
});

test('a transaction client works and the pool may be absent', async () => {
  const client = createPool(() => ({ rows: [progressRow()] }));
  const repo = new EmbeddingBackfillProgressRepository(null);

  const record = await repo.markInProgress({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3
  }, { client });

  assert.equal(record.documentId, 'doc-1');
  assert.equal(client.calls.length, 1);
});

test('methods throw when neither pool nor client is configured', async () => {
  const repo = new EmbeddingBackfillProgressRepository(null);

  await assert.rejects(() => repo.getProgress('space', 'doc'), DatabaseError);
});

test('markInProgress refuses to restart a completed row', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markInProgress({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3
  });

  const [{ sql }] = pool.calls;
  assert.match(sql, /WHERE embedding_backfill_progress\.status IN \('pending', 'in_progress', 'failed'\)/);
  assert.equal(record, null);
});

test('markInProgress still permits a legitimate retry from failed', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'in_progress' })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.markInProgress({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: 3 });

  const [{ sql }] = pool.calls;
  assert.match(sql, /'failed'/);
  assert.match(sql, /attempts = embedding_backfill_progress\.attempts \+ 1/);
});

test('updateProgressCounts only updates in_progress rows', async () => {
  const pool = createPool(() => ({ rows: [progressRow()] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.updateProgressCounts({
    spaceId: 'space-1',
    documentId: 'doc-1',
    completedChunkCount: 2
  });

  const [{ sql }] = pool.calls;
  assert.match(sql, /AND status IN \('in_progress'\)/);
});

test('updateProgressCounts returns null when the row is not in_progress', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool(() => ({ rows: [] })));

  const result = await repo.updateProgressCounts({
    spaceId: 'space-1',
    documentId: 'doc-1',
    completedChunkCount: 2
  });

  assert.equal(result, null);
});

test('markCompleted refuses to overwrite an already completed row', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markCompleted({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3,
    completedChunkCount: 3
  });

  const [{ sql }] = pool.calls;
  assert.match(sql, /WHERE embedding_backfill_progress\.status IN \('in_progress', 'pending', 'failed'\)/);
  assert.equal(record, null);
});

test('markFailed is a no-op against a completed row (stale failure handler)', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markFailed({
    spaceId: 'space-1',
    documentId: 'doc-1',
    lastError: 'late failure',
    completedChunkCount: 1
  });

  const [{ sql }] = pool.calls;
  assert.match(sql, /AND status IN \('in_progress', 'pending', 'failed'\)/);
  assert.equal(record, null);
});

test('markFailed still records a failure for an in_progress or pending row', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'failed', last_error: 'boom' })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.markFailed({
    spaceId: 'space-1',
    documentId: 'doc-1',
    lastError: 'boom',
    completedChunkCount: 1
  });

  assert.equal(record.status, 'failed');
});

test('claimDocument inserts a lease and returns the first attempt', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'in_progress', attempts: 1 })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.claimDocument({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3,
    completedChunkCount: 0,
    leaseMs: 60000
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /ON CONFLICT \(space_id, document_id\)/);
  assert.match(sql, /embedding_backfill_progress\.status IN \('pending', 'failed'\)/);
  assert.match(sql, /embedding_backfill_progress\.status = 'in_progress'/);
  assert.match(sql, /updated_at < now\(\) - \(\$6 \* interval '1 millisecond'\)/);
  assert.match(sql, /attempts = embedding_backfill_progress\.attempts \+ 1/);
  assert.deepEqual(params, ['space-1', 'doc-1', 3, 0, null, 60000]);
  assert.equal(record.attempts, 1);
});

test('claimDocument defaults to the documented lease and returns null when refused', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.claimDocument({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: 3 });

  const [{ params }] = pool.calls;
  assert.equal(params.at(-1), 5 * 60 * 1000);
  assert.equal(record, null);
});

test('claimDocument validates the key, counters, and lease', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  await assert.rejects(
    () => repo.claimDocument({ spaceId: '', documentId: 'doc-1', expectedChunkCount: 3 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.claimDocument({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: -1 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.claimDocument({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: 3, leaseMs: 0 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.claimDocument({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: 3, leaseMs: 99999999 }),
    ValidationError
  );
});

test('renewClaim extends the lease only for the current attempt', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ attempts: 4 })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  const record = await repo.renewClaim({ spaceId: 'space-1', documentId: 'doc-1', attempt: 4 });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /SET updated_at = now\(\)/);
  assert.match(sql, /AND attempts = \$3/);
  assert.deepEqual(params, ['space-1', 'doc-1', 4]);
  assert.equal(record.attempts, 4);
});

test('renewClaim returns null when the attempt has been superseded', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool(() => ({ rows: [] })));

  assert.equal(await repo.renewClaim({ spaceId: 'space-1', documentId: 'doc-1', attempt: 1 }), null);
});

test('renewClaim requires a positive integer attempt', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  await assert.rejects(() => repo.renewClaim({ spaceId: 'space-1', documentId: 'doc-1', attempt: 0 }), ValidationError);
  await assert.rejects(() => repo.renewClaim({ spaceId: 'space-1', documentId: 'doc-1', attempt: 1.2 }), ValidationError);
});

test('updateProgressCounts appends the fencing token when an attempt is supplied', async () => {
  const pool = createPool(() => ({ rows: [progressRow()] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.updateProgressCounts({
    spaceId: 'space-1',
    documentId: 'doc-1',
    completedChunkCount: 2,
    tokenCount: 5,
    tokensAvailable: true,
    attempt: 7
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /AND attempts = \$6/);
  assert.deepEqual(params, ['space-1', 'doc-1', 2, 5, true, 7]);
});

test('markCompleted appends the fencing token when an attempt is supplied', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'completed' })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.markCompleted({
    spaceId: 'space-1',
    documentId: 'doc-1',
    expectedChunkCount: 3,
    completedChunkCount: 3,
    attempt: 7
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /AND embedding_backfill_progress\.attempts = \$8/);
  assert.equal(params.at(-1), 7);
});

test('markFailed appends the fencing token when an attempt is supplied', async () => {
  const pool = createPool(() => ({ rows: [progressRow({ status: 'failed' })] }));
  const repo = new EmbeddingBackfillProgressRepository(pool);

  await repo.markFailed({
    spaceId: 'space-1',
    documentId: 'doc-1',
    lastError: 'boom',
    completedChunkCount: 1,
    attempt: 7
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /AND attempts = \$7/);
  assert.equal(params.at(-1), 7);
});

test('fenced writes reject a non-positive attempt token', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  await assert.rejects(
    () => repo.updateProgressCounts({ spaceId: 'space-1', documentId: 'doc-1', completedChunkCount: 1, attempt: 0 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.markCompleted({ spaceId: 'space-1', documentId: 'doc-1', expectedChunkCount: 1, completedChunkCount: 1, attempt: -2 }),
    ValidationError
  );
  await assert.rejects(
    () => repo.markFailed({ spaceId: 'space-1', documentId: 'doc-1', attempt: 1.5 }),
    ValidationError
  );
});

test('usage writes reject negative or non-integer token counts', async () => {
  const repo = new EmbeddingBackfillProgressRepository(createPool());

  for (const tokenCount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => repo.updateProgressCounts({
        spaceId: 'space-1',
        documentId: 'doc-1',
        completedChunkCount: 1,
        tokenCount
      }),
      ValidationError
    );

    await assert.rejects(
      () => repo.markCompleted({
        spaceId: 'space-1',
        documentId: 'doc-1',
        expectedChunkCount: 1,
        completedChunkCount: 1,
        tokenCount
      }),
      ValidationError
    );

    await assert.rejects(
      () => repo.markFailed({
        spaceId: 'space-1',
        documentId: 'doc-1',
        completedChunkCount: 1,
        tokenCount
      }),
      ValidationError
    );
  }
});
