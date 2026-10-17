import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { ChunkEmbeddingRepository } from '../../server/embeddings/chunkEmbeddingRepository.js';
import { EmbeddingBackfillProgressRepository } from '../../server/embeddings/embeddingBackfillProgressRepository.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { withTransaction, createEmbeddingBackfillRunner } from '../../server/embeddings/embeddingBackfillRunner.js';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';
import {
  INTEGRATION_DB_ENV,
  acquireClient,
  applySchema,
  assertInvariant,
  createIntegrationPool,
  insertChunk,
  insertChunkEmbedding,
  insertDocument,
  readInvariantState,
  releaseClient,
  resetSchema,
  resolveIntegrationTarget,
  verifyIntegrationTarget
} from './lib/backfill-harness.js';

const SPACE_ID = VOYAGE_SPACE.id;
const DIMENSIONS = VOYAGE_SPACE.dimensions;

let target = null;
let configError = null;

try {
  target = resolveIntegrationTarget();
} catch (error) {
  configError = error;
}

let pool = null;
let skipReason = null;

before(async () => {
  if (configError) {
    throw configError;
  }

  if (!target) {
    skipReason = `Set ${INTEGRATION_DB_ENV} to a disposable local database to run these tests.`;
    return;
  }

  pool = createIntegrationPool(target);
  await verifyIntegrationTarget(pool, target);
  await resetSchema(pool);
  await applySchema(pool);
});

after(async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubEmbeddings(count) {
  return Array.from({ length: count }, () => Array.from({ length: DIMENSIONS }, () => 0.01));
}

function stubProvider() {
  return {
    async embedMany(texts) {
      return stubEmbeddings(texts.length);
    }
  };
}

function createRunner(provider) {
  return createEmbeddingBackfillRunner({
    pool,
    documentsRepository: new DocumentsRepository(pool),
    embeddingRepository: new EmbeddingRepository(pool),
    chunkEmbeddingRepository: new ChunkEmbeddingRepository(pool),
    embeddingBackfillProgressRepository: new EmbeddingBackfillProgressRepository(pool),
    embeddingProvider: provider,
    space: VOYAGE_SPACE,
    logger: { error() {}, log() {} }
  });
}

async function seedDocument({ chunks = 2, embed = true, complete = false } = {}) {
  const documentId = randomUUID();
  const chunkIds = [];

  await insertDocument(pool, { id: documentId });

  for (let index = 1; index <= chunks; index += 1) {
    const chunkId = randomUUID();
    chunkIds.push(chunkId);
    await insertChunk(pool, { id: chunkId, documentId, chunkIndex: index });

    if (embed) {
      await insertChunkEmbedding(pool, { chunkId, documentId, spaceId: SPACE_ID });
    }
  }

  if (complete) {
    const progress = new EmbeddingBackfillProgressRepository(pool);
    await progress.markCompleted({
      spaceId: SPACE_ID,
      documentId,
      expectedChunkCount: chunks,
      completedChunkCount: chunks
    });
  }

  return { documentId, chunkIds };
}

function replacementSet() {
  return [
    { chunkIndex: 1, content: 'replacement one', characterCount: 15 },
    { chunkIndex: 2, content: 'replacement two', characterCount: 15 }
  ];
}

// ---------------------------------------------------------------------------
// Invalidation: a chunk-set mutation must void recorded backfill progress
// atomically, in the same transaction as the replacement.
// ---------------------------------------------------------------------------

test('replacing the chunk set invalidates a completed progress row in the same transaction', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ complete: true });
  const chunkRepository = new ChunkRepository(pool);

  const before = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(before.progressStatus, 'completed');
  assert.equal(before.invariantViolated, false);

  await chunkRepository.replaceDocumentChunks(documentId, replacementSet());

  const after = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(after.chunkCount, 2);
  assert.equal(after.embeddedCount, 0, 'the new chunk set starts with no embeddings');
  assert.equal(after.progressStatus, null, 'completed progress is invalidated atomically with the replacement');
  assert.equal(after.invariantViolated, false);
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('replacing chunks for a deleted document is a clean no-op', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument();
  const chunkRepository = new ChunkRepository(pool);

  await pool.query('DELETE FROM documents WHERE id = $1', [documentId]);

  const result = await chunkRepository.replaceDocumentChunks(documentId, [
    { chunkIndex: 1, content: 'orphan', characterCount: 6 }
  ]);

  assert.deepEqual(result, [], 'no chunks are written when the document row lock finds no row');

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM chunks WHERE document_id = $1',
    [documentId]
  );
  assert.equal(rows[0].n, 0);
});

// ---------------------------------------------------------------------------
// Serialization: chunk replacement, completion, and deletion share the same
// document row lock, so they can never interleave inside their critical
// sections.
// ---------------------------------------------------------------------------

test('a completion holding the document lock blocks a concurrent chunk replacement', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ complete: true });
  const documentsRepository = new DocumentsRepository(pool);
  const chunkRepository = new ChunkRepository(pool);
  const chunkEmbeddings = new ChunkEmbeddingRepository(pool);
  const progress = new EmbeddingBackfillProgressRepository(pool);

  const clientA = await acquireClient(pool);
  let replacement = null;
  let settled = false;

  try {
    await clientA.query('BEGIN');

    const locked = await documentsRepository.lockForUpdate(documentId, { client: clientA });
    assert.ok(locked, 'the completion side acquires the document row lock');

    const verification = await chunkEmbeddings.isDocumentFullyEmbedded(documentId, SPACE_ID, { client: clientA });
    assert.equal(verification.complete, true);

    replacement = chunkRepository.replaceDocumentChunks(documentId, replacementSet())
      .then((value) => {
        settled = true;
        return value;
      });

    await sleep(150);
    assert.equal(settled, false, 'replacement must block while the completion holds the document lock');

    await progress.markCompleted({
      spaceId: SPACE_ID,
      documentId,
      expectedChunkCount: verification.totalChunks,
      completedChunkCount: verification.embeddedChunks
    }, { client: clientA });
    await clientA.query('COMMIT');

    await replacement;
  } finally {
    await releaseClient(clientA);
    if (replacement) {
      await replacement.catch(() => {});
    }
  }

  const state = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 2, 'the replacement applied after the completion committed');
  assert.equal(state.embeddedCount, 0);
  assert.equal(state.progressStatus, null, 'the replacement then invalidated the completed progress row');
  assert.equal(state.invariantViolated, false);
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('document deletion serializes on the same document lock', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ complete: true });
  const documentsRepository = new DocumentsRepository(pool);

  const clientA = await acquireClient(pool);
  const clientB = await acquireClient(pool);
  let deletion = null;
  let settled = false;

  try {
    await clientA.query('BEGIN');
    await documentsRepository.lockForUpdate(documentId, { client: clientA });

    deletion = (async () => {
      await clientB.query('DELETE FROM documents WHERE id = $1', [documentId]);
      await clientB.query('COMMIT');
      settled = true;
    })();

    await sleep(150);
    assert.equal(settled, false, 'deletion must block while the document row is locked');

    await clientA.query('COMMIT');
    await deletion;
  } finally {
    await releaseClient(clientA);
    if (deletion) {
      await deletion.catch(() => {});
    }
    await releaseClient(clientB);
  }

  const state = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 0, 'chunks cascade away with the document');
  assert.equal(state.progressStatus, null, 'progress cascades away with the document');
  assert.equal(state.invariantViolated, false);
});

test('two concurrent chunk replacements serialize without deadlocking', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const chunkRepository = new ChunkRepository(pool);

  const setA = [
    { chunkIndex: 1, content: 'A one', characterCount: 5 },
    { chunkIndex: 2, content: 'A two', characterCount: 5 }
  ];
  const setB = [
    { chunkIndex: 1, content: 'B one', characterCount: 5 }
  ];

  const [resultA, resultB] = await Promise.all([
    chunkRepository.replaceDocumentChunks(documentId, setA),
    chunkRepository.replaceDocumentChunks(documentId, setB)
  ]);

  assert.ok(Array.isArray(resultA));
  assert.ok(Array.isArray(resultB));

  const state = await readInvariantState(pool, documentId, SPACE_ID);
  assert.ok(
    state.chunkCount === 1 || state.chunkCount === 2,
    `one of the two replacement sets wins (saw ${state.chunkCount} chunks)`
  );
  assert.notEqual(state.progressStatus, 'completed');
  await assertInvariant(pool, documentId, SPACE_ID);
});

// ---------------------------------------------------------------------------
// Real runner end-to-end: a replacement during embedding is detected and the
// attempt fails safely; a completed document is re-completed after a re-chunk.
// ---------------------------------------------------------------------------

test('replacing the chunk set during embedding fails the attempt safely', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const chunkRepository = new ChunkRepository(pool);

  const called = deferred();
  const release = deferred();

  const provider = {
    async embedMany(texts) {
      called.resolve();
      await release.promise;
      return stubEmbeddings(texts.length);
    }
  };

  const runner = createRunner(provider);
  const backfill = runner.backfillDocument(documentId);

  // Pause while the provider is in flight; no transaction is open at that
  // moment, so the replacement is free to run.
  await called.promise;

  await chunkRepository.replaceDocumentChunks(documentId, [
    { chunkIndex: 1, content: 'replacement', characterCount: 11 }
  ]);

  release.resolve();
  const result = await backfill;

  assert.equal(result.status, 'failed', 'the attempt is abandoned rather than falsely completing');

  const state = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 1, 'only the replacement chunk set remains');
  assert.equal(state.progressStatus, null, 'the replacement invalidated the in-progress progress row');
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('the real runner completes a document, and re-completes it after a replacement', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const chunkRepository = new ChunkRepository(pool);
  const runner = createRunner(stubProvider());

  const first = await runner.backfillDocument(documentId);
  assert.equal(first.status, 'completed');
  assert.equal(first.embeddedChunks, 2);

  const completedState = await assertInvariant(pool, documentId, SPACE_ID);
  assert.equal(completedState.progressStatus, 'completed');
  assert.equal(completedState.missingCount, 0);

  // Re-chunking voids the completed status and leaves the new set unembedded.
  await chunkRepository.replaceDocumentChunks(documentId, [
    { chunkIndex: 1, content: 'replaced', characterCount: 8 }
  ]);
  const invalidated = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(invalidated.progressStatus, null);
  assert.equal(invalidated.embeddedCount, 0);

  const second = await runner.backfillDocument(documentId);
  assert.equal(second.status, 'completed');
  assert.equal(second.embeddedChunks, 1);

  const finalState = await assertInvariant(pool, documentId, SPACE_ID);
  assert.equal(finalState.progressStatus, 'completed');
  assert.equal(finalState.missingCount, 0);
});

// ---------------------------------------------------------------------------
// Repository guards and transaction semantics that the protocol relies on.
// ---------------------------------------------------------------------------

test('C (guard): a stale failure handler cannot un-complete a completed document', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument();
  const progress = new EmbeddingBackfillProgressRepository(pool);

  await progress.markCompleted({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    completedChunkCount: 2
  });

  const staleResult = await progress.markFailed({
    spaceId: SPACE_ID,
    documentId,
    lastError: 'late failure from an overlapping attempt',
    completedChunkCount: 1
  });

  assert.equal(staleResult, null, 'guarded markFailed is a no-op against a completed row');

  const after = await progress.getProgress(SPACE_ID, documentId);
  assert.equal(after.status, 'completed');
  assert.equal(after.completedChunkCount, 2);
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('C2 (race): failure and completion on separate connections settle coherently', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument();
  const progress = new EmbeddingBackfillProgressRepository(pool);

  await progress.markInProgress({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    completedChunkCount: 0
  });

  const clientA = await acquireClient(pool);
  const clientB = await acquireClient(pool);
  let failure = null;

  try {
    await clientA.query('BEGIN');
    const completion = await progress.markCompleted({
      spaceId: SPACE_ID,
      documentId,
      expectedChunkCount: 2,
      completedChunkCount: 2
    }, { client: clientA });

    failure = (async () => {
      await clientB.query('BEGIN');
      const res = await progress.markFailed({
        spaceId: SPACE_ID,
        documentId,
        lastError: 'racing failure',
        completedChunkCount: 1
      }, { client: clientB });
      await clientB.query('COMMIT');
      return res;
    })();

    await sleep(75);
    await clientA.query('COMMIT');

    const failureResult = await failure;
    assert.equal(completion.status, 'completed');
    assert.equal(failureResult, null, 'failure handler blocked once completion committed');
  } finally {
    await releaseClient(clientA);
    if (failure) {
      await failure.catch(() => {});
    }
    await releaseClient(clientB);
  }

  const after = await progress.getProgress(SPACE_ID, documentId);
  assert.equal(after.status, 'completed');
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('D (rollback): a mid-transaction failure rolls back the embedding and leaves progress truthful', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId, chunkIds } = await seedDocument({ embed: false });
  const chunkEmbeddings = new ChunkEmbeddingRepository(pool);
  const progress = new EmbeddingBackfillProgressRepository(pool);

  await progress.markInProgress({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    completedChunkCount: 0
  });

  await assert.rejects(
    () => withTransaction(pool, async (client) => {
      await chunkEmbeddings.upsertChunkEmbedding({
        chunkId: chunkIds[0],
        spaceId: SPACE_ID,
        embedding: stubEmbeddings(1)[0],
        l2Norm: 1
      }, { client });

      await progress.updateProgressCounts({
        spaceId: SPACE_ID,
        documentId,
        completedChunkCount: 1
      }, { client });

      throw new Error('simulated crash after upsert and progress update, before commit');
    }),
    /simulated crash/
  );

  const afterFailure = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(afterFailure.embeddedCount, 0, 'the embedding upsert was rolled back');
  assert.equal(afterFailure.progressStatus, 'in_progress');

  const progressRow = await progress.getProgress(SPACE_ID, documentId);
  assert.equal(progressRow.completedChunkCount, 0, 'the progress update was rolled back');

  await withTransaction(pool, async (client) => {
    await chunkEmbeddings.upsertChunkEmbedding({
      chunkId: chunkIds[0],
      spaceId: SPACE_ID,
      embedding: stubEmbeddings(1)[0],
      l2Norm: 1
    }, { client });

    await progress.updateProgressCounts({
      spaceId: SPACE_ID,
      documentId,
      completedChunkCount: 1
    }, { client });
  });

  const afterRecovery = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(afterRecovery.embeddedCount, 1);
  assert.equal((await progress.getProgress(SPACE_ID, documentId)).completedChunkCount, 1);
});

test('E (convergence): two concurrent attempts on the same document settle safely', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId, chunkIds } = await seedDocument({ embed: false });
  const chunkEmbeddings = new ChunkEmbeddingRepository(pool);
  const progress = new EmbeddingBackfillProgressRepository(pool);

  async function runAttempt(client) {
    await client.query('BEGIN');

    await progress.markInProgress({
      spaceId: SPACE_ID,
      documentId,
      expectedChunkCount: 2,
      completedChunkCount: 0
    }, { client });

    for (const chunkId of chunkIds) {
      await chunkEmbeddings.upsertChunkEmbedding({
        chunkId,
        spaceId: SPACE_ID,
        embedding: stubEmbeddings(1)[0],
        l2Norm: 1
      }, { client });
    }

    await progress.updateProgressCounts({
      spaceId: SPACE_ID,
      documentId,
      completedChunkCount: 2
    }, { client });

    const verification = await chunkEmbeddings.isDocumentFullyEmbedded(documentId, SPACE_ID, { client });

    if (verification.complete) {
      await progress.markCompleted({
        spaceId: SPACE_ID,
        documentId,
        expectedChunkCount: verification.totalChunks,
        completedChunkCount: verification.embeddedChunks
      }, { client });
    }

    await client.query('COMMIT');
  }

  const clientA = await acquireClient(pool);
  const clientB = await acquireClient(pool);
  let attemptA = null;
  let attemptB = null;

  try {
    attemptA = runAttempt(clientA);
    attemptB = (async () => {
      await sleep(20);
      return runAttempt(clientB);
    })();

    await Promise.all([attemptA, attemptB]);
  } finally {
    await releaseClient(clientA);
    await Promise.allSettled([attemptA, attemptB].filter(Boolean));
    await releaseClient(clientB);
  }

  const state = await readInvariantState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 2);
  assert.equal(state.embeddedCount, 2);
  assert.equal(state.missingCount, 0);
  assert.equal(state.progressStatus, 'completed');
  await assertInvariant(pool, documentId, SPACE_ID);
});
// ---------------------------------------------------------------------------
// Claim / lease / fencing protocol: the actual mutual-exclusion guarantee that
// stops two workers from spending tokens on the same document.
// ---------------------------------------------------------------------------

test('F1 (claim): only one worker can claim a document under a live lease', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const progress = new EmbeddingBackfillProgressRepository(pool);

  const first = await progress.claimDocument({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    leaseMs: 60000
  });
  assert.ok(first, 'the first claim succeeds');
  assert.equal(first.attempts, 1, 'the first claim records attempt 1');
  assert.equal(first.status, 'in_progress');

  const second = await progress.claimDocument({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    leaseMs: 60000
  });
  assert.equal(second, null, 'a second claim against a live lease is refused');

  // Expire the lease, then prove the document becomes claimable again.
  await pool.query(
    "UPDATE embedding_backfill_progress SET updated_at = now() - interval '10 minutes' WHERE space_id = $1 AND document_id = $2",
    [SPACE_ID, documentId]
  );

  const takeover = await progress.claimDocument({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    leaseMs: 60000
  });
  assert.ok(takeover, 'an expired lease can be taken over');
  assert.equal(takeover.attempts, 2, 'the takeover increments the fencing token');

  await assertInvariant(pool, documentId, SPACE_ID);
});

test('F2 (fence): a superseded attempt cannot write progress, failure, or completion', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const progress = new EmbeddingBackfillProgressRepository(pool);

  const stale = await progress.claimDocument({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    leaseMs: 60000
  });
  assert.equal(stale.attempts, 1);

  // A newer worker takes the document over.
  await pool.query(
    "UPDATE embedding_backfill_progress SET updated_at = now() - interval '10 minutes' WHERE space_id = $1 AND document_id = $2",
    [SPACE_ID, documentId]
  );
  const fresh = await progress.claimDocument({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    leaseMs: 60000
  });
  assert.equal(fresh.attempts, 2);

  const staleUpdate = await progress.updateProgressCounts({
    spaceId: SPACE_ID,
    documentId,
    completedChunkCount: 1,
    attempt: stale.attempts
  });
  assert.equal(staleUpdate, null, 'a stale progress write is refused');

  const staleFailure = await progress.markFailed({
    spaceId: SPACE_ID,
    documentId,
    lastError: 'stale failure',
    completedChunkCount: 1,
    attempt: stale.attempts
  });
  assert.equal(staleFailure, null, 'a stale failure write is refused');

  const staleCompletion = await progress.markCompleted({
    spaceId: SPACE_ID,
    documentId,
    expectedChunkCount: 2,
    completedChunkCount: 2,
    attempt: stale.attempts
  });
  assert.equal(staleCompletion, null, 'a stale completion write is refused');

  const staleRenew = await progress.renewClaim({
    spaceId: SPACE_ID,
    documentId,
    attempt: stale.attempts
  });
  assert.equal(staleRenew, null, 'a stale attempt cannot renew the lease');

  // The current attempt still writes and renews.
  const freshUpdate = await progress.updateProgressCounts({
    spaceId: SPACE_ID,
    documentId,
    completedChunkCount: 2,
    attempt: fresh.attempts
  });
  assert.ok(freshUpdate, 'the current attempt still writes progress');

  const freshRenew = await progress.renewClaim({
    spaceId: SPACE_ID,
    documentId,
    attempt: fresh.attempts
  });
  assert.ok(freshRenew, 'the current attempt can still renew the lease');

  const after = await progress.getProgress(SPACE_ID, documentId);
  assert.equal(after.status, 'in_progress');
  assert.equal(after.completedChunkCount, 2);
  await assertInvariant(pool, documentId, SPACE_ID);
});

test('F3 (double-spend): concurrent runners cannot both spend the provider', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false, chunks: 3 });

  let providerCalls = 0;
  const provider = {
    async embedMany(texts) {
      providerCalls += 1;
      await sleep(50);
      return stubEmbeddings(texts.length);
    }
  };

  const runner = createRunner(provider);
  const results = await Promise.all([
    runner.backfillDocument(documentId),
    runner.backfillDocument(documentId)
  ]);

  assert.equal(providerCalls, 1, 'the provider is dispatched exactly once for the shared document');
  assert.ok(
    results.every((result) => result.status !== 'failed'),
    `neither concurrent attempt fails (saw ${results.map((result) => result.status).join(', ')})`
  );
  assert.ok(
    results.some((result) => result.status === 'completed'),
    'at least one attempt completes the document'
  );

  const state = await assertInvariant(pool, documentId, SPACE_ID);
  assert.equal(state.missingCount, 0, 'every chunk ends up embedded');
  assert.equal(state.progressStatus, 'completed');
});

// ---------------------------------------------------------------------------
// Bounded waits: SET LOCAL timeouts are applied, fire, and never leak.
// ---------------------------------------------------------------------------

test('F4 (bounds): transaction timeouts are scoped to the transaction and never leak', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const documentsRepository = new DocumentsRepository(pool);

  const before = await pool.query('SHOW lock_timeout');
  const beforeValue = before.rows[0].lock_timeout;

  await assert.rejects(
    () => withTransaction(pool, async (client) => {
      const during = await client.query('SHOW lock_timeout');
      assert.equal(during.rows[0].lock_timeout, '100ms', 'lock_timeout is bounded inside the transaction');
      throw new Error('force rollback so the limits are observable after the fact');
    }, { lockTimeoutMs: 100, statementTimeoutMs: 30000, idleInTransactionTimeoutMs: 30000 }),
    /force rollback/
  );

  const after = await pool.query('SHOW lock_timeout');
  assert.equal(after.rows[0].lock_timeout, beforeValue, 'SET LOCAL does not leak onto the pooled connection');
});

test('F5 (bounds): a held document lock times out instead of hanging the pool', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedDocument({ embed: false });
  const documentsRepository = new DocumentsRepository(pool);

  const blocker = await acquireClient(pool);

  try {
    await blocker.query('BEGIN');
    const locked = await documentsRepository.lockForUpdate(documentId, { client: blocker });
    assert.ok(locked, 'the blocker holds the document row lock');

    const startedAt = Date.now();
    await assert.rejects(
      () => withTransaction(pool, async (client) => {
        await documentsRepository.lockForUpdate(documentId, { client });
      }, { lockTimeoutMs: 100, statementTimeoutMs: 30000, idleInTransactionTimeoutMs: 30000 }),
      (error) => error.code === '55P03',
      'the bounded lock wait fails with PostgreSQL lock timeout (55P03)'
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 5000, `the lock timed out in ${elapsed}ms rather than hanging`);
  } finally {
    await releaseClient(blocker);
  }
});
