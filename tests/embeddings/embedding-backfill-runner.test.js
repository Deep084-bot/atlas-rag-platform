import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createEmbeddingBackfillRunner,
  classifyBackfillError,
  withTransaction
} from '../../server/embeddings/embeddingBackfillRunner.js';
import { HOSTED_BGE_SPACE, VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { DatabaseError, ProviderError, ValidationError } from '../../server/errors.js';

function vec(dimensions = 1024) {
  return Array.from({ length: dimensions }, () => 0.001);
}

function outcomeFn(value, defaultFn) {
  if (value === undefined) {
    return defaultFn;
  }

  if (typeof value === 'function') {
    return value;
  }

  return () => value;
}

function createHarness({
  document = { id: 'doc-1', status: 'ready' },
  chunks,
  missingChunkIds,
  provider,
  upsertResult = (args) => ({ chunkId: args.chunkId, spaceId: args.spaceId }),
  batchSize = 8,
  runInTransaction = null,
  documentLock,
  verification,
  claimDocument,
  renewClaim,
  updateProgressCounts,
  markCompleted,
  markFailed,
  getProgress,
  eligibilityPolicy
} = {}) {
  const chunkList = chunks ?? [
    { id: 'c1', content: 'one' },
    { id: 'c2', content: 'two' },
    { id: 'c3', content: 'three' }
  ];
  const missing = missingChunkIds ?? chunkList.map((chunk) => chunk.id);
  const calls = { progress: [], chunkUpserts: [], providerBatches: [], verifications: [], documentLocks: [], events: [] };

  const documentLockFn = documentLock === undefined
    ? () => document
    : (typeof documentLock === 'function' ? documentLock : () => documentLock);

  const documentsRepository = {
    getDocumentById: async () => document,
    async lockForUpdate(documentId, options) {
      calls.documentLocks.push({ documentId, options });
      calls.events.push({ type: 'documentLock' });
      return documentLockFn(documentId, options);
    }
  };

  const embeddingRepository = {
    countTotalChunks: async () => chunkList.length,
    getChunksForDocument: async () => chunkList
  };

  const verificationFn = outcomeFn(verification, () => ({
    totalChunks: chunkList.length,
    embeddedChunks: chunkList.length,
    missingChunks: 0,
    complete: true
  }));

  const chunkEmbeddingRepository = {
    findChunkIdsMissingEmbedding: async () => missing,
    async upsertChunkEmbedding(args, options) {
      calls.chunkUpserts.push({ args, options });
      return upsertResult(args);
    },
    async isDocumentFullyEmbedded(documentId, spaceId, options) {
      calls.events.push({ type: 'verification' });
      const record = verificationFn(documentId, spaceId, options);
      calls.verifications.push(record);
      return record;
    }
  };

  let claimCount = 0;
  const claimDocumentFn = outcomeFn(claimDocument, (payload) => {
    claimCount += 1;
    return { ...payload, status: 'in_progress', attempts: claimCount };
  });
  const renewClaimFn = outcomeFn(renewClaim, (payload) => ({ ...payload, status: 'in_progress' }));
  const updateProgressCountsFn = outcomeFn(updateProgressCounts, (payload) => ({ ...payload }));
  const markCompletedFn = outcomeFn(markCompleted, (payload) => ({ ...payload, status: 'completed' }));
  const markFailedFn = outcomeFn(markFailed, (payload) => ({ ...payload, status: 'failed' }));
  const getProgressFn = outcomeFn(getProgress, () => null);

  const embeddingBackfillProgressRepository = {
    async claimDocument(payload, options) {
      calls.progress.push({ method: 'claimDocument', payload, options });
      return claimDocumentFn(payload, options);
    },
    async renewClaim(payload, options) {
      calls.progress.push({ method: 'renewClaim', payload, options });
      return renewClaimFn(payload, options);
    },
    async updateProgressCounts(payload, options) {
      calls.progress.push({ method: 'updateProgressCounts', payload, options });
      return updateProgressCountsFn(payload, options);
    },
    async markCompleted(payload, options) {
      calls.progress.push({ method: 'markCompleted', payload, options });
      return markCompletedFn(payload, options);
    },
    async markFailed(payload, options) {
      calls.progress.push({ method: 'markFailed', payload, options });
      return markFailedFn(payload, options);
    },
    async getProgress(spaceId, documentId, options) {
      calls.progress.push({ method: 'getProgress', payload: { spaceId, documentId }, options });
      return getProgressFn(spaceId, documentId, options);
    }
  };

  const callsToProvider = [];
  const recordedProvider = {};

  if (provider && typeof provider.embedMany === 'function') {
    recordedProvider.embedMany = async (texts) => {
      callsToProvider.push(texts.slice());
      return provider.embedMany(texts);
    };
  }

  if (provider && typeof provider.embedManyWithUsage === 'function') {
    recordedProvider.embedManyWithUsage = async (texts) => {
      callsToProvider.push(texts.slice());
      return provider.embedManyWithUsage(texts);
    };
  }

  const fakeClient = { query: async () => ({ rows: [] }) };
  const runInTransactionImpl = runInTransaction ?? (async (fn) => fn(fakeClient));

  const runner = createEmbeddingBackfillRunner({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository,
    embeddingBackfillProgressRepository,
    embeddingProvider: recordedProvider,
    space: VOYAGE_SPACE,
    batchSize,
    eligibilityPolicy,
    runInTransaction: runInTransactionImpl,
    logger: { error() {}, log() {} }
  });

  return {
    runner,
    fakeClient,
    providerBatches: callsToProvider,
    calls,
    progressCalls(method) {
      return calls.progress.filter((call) => call.method === method);
    }
  };
}

test('construction rejects a non-table (legacy) space', () => {
  assert.throws(
    () => createEmbeddingBackfillRunner({
      space: HOSTED_BGE_SPACE,
      documentsRepository: {},
      embeddingRepository: {},
      chunkEmbeddingRepository: {},
      embeddingBackfillProgressRepository: {},
      embeddingProvider: { embedMany: async () => [] }
    }),
    ValidationError
  );

  assert.throws(
    () => createEmbeddingBackfillRunner({
      documentsRepository: {},
      embeddingRepository: {},
      chunkEmbeddingRepository: {},
      embeddingBackfillProgressRepository: {},
      embeddingProvider: { embedMany: async () => [] }
    }),
    ValidationError
  );
});

test('construction requires every collaborator and a sane batch size', () => {
  const base = {
    space: VOYAGE_SPACE,
    documentsRepository: { lockForUpdate: async () => ({ id: 'doc-1' }) },
    embeddingRepository: {},
    chunkEmbeddingRepository: {},
    embeddingBackfillProgressRepository: {},
    embeddingProvider: { embedMany: async () => [] }
  };

  assert.throws(() => createEmbeddingBackfillRunner({ ...base, embeddingProvider: null }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, chunkEmbeddingRepository: null }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, documentsRepository: {} }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, batchSize: 0 }), ValidationError);
});

test('planDocument is read-only and reports the missing count', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }],
    missingChunkIds: ['c2', 'c3', 'c4'],
    provider: { embedMany: async () => [] }
  });

  const plan = await harness.runner.planDocument('doc-1');

  assert.deepEqual(plan, {
    documentId: 'doc-1',
    spaceId: VOYAGE_SPACE.id,
    totalChunks: 4,
    embeddedChunks: 1,
    missingChunks: 3,
    complete: false
  });
  assert.equal(harness.calls.progress.length, 0);
  assert.equal(harness.providerBatches.length, 0);
});

test('planDocument returns null for a missing document', async () => {
  const harness = createHarness({ document: null, provider: { embedMany: async () => [] } });

  assert.equal(await harness.runner.planDocument('ghost'), null);
});

test('backfillDocument embeds missing chunks, updates progress, and completes', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    batchSize: 2
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(result.embeddedChunks, 3);
  assert.equal(result.totalChunks, 3);

  assert.equal(harness.providerBatches.length, 2);
  assert.deepEqual(harness.providerBatches[0], ['one', 'two']);
  assert.deepEqual(harness.providerBatches[1], ['three']);

  const upsertedChunkIds = harness.calls.chunkUpserts.map((call) => call.args.chunkId);
  assert.deepEqual(upsertedChunkIds, ['c1', 'c2', 'c3']);
  assert.equal(harness.calls.chunkUpserts[0].args.spaceId, VOYAGE_SPACE.id);
  assert.ok(Number.isFinite(harness.calls.chunkUpserts[0].args.l2Norm));

  const timeline = harness.calls.progress.map((call) => call.method);
  assert.deepEqual(timeline, [
    'claimDocument',
    'renewClaim',
    'updateProgressCounts',
    'renewClaim',
    'updateProgressCounts',
    'markCompleted'
  ]);

  const completion = harness.progressCalls('markCompleted')[0];
  assert.equal(completion.payload.expectedChunkCount, 3);
  assert.equal(completion.payload.completedChunkCount, 3);
});

test('backfillDocument resumes from the chunks that already have embeddings', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }, { id: 'c3', content: 'three' }, { id: 'c4', content: 'four' }],
    missingChunkIds: ['c2', 'c3', 'c4'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.embeddedChunks, 4);
  assert.equal(harness.providerBatches.length, 1);
  assert.deepEqual(harness.providerBatches[0], ['two', 'three', 'four']);
  assert.deepEqual(
    harness.calls.chunkUpserts.map((call) => call.args.chunkId),
    ['c2', 'c3', 'c4']
  );
  assert.equal(harness.progressCalls('claimDocument')[0].payload.completedChunkCount, 1);
});

test('backfillDocument marks an already-complete document without calling the provider', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1' }, { id: 'c2' }],
    missingChunkIds: [],
    provider: { embedMany: async () => { throw new Error('should not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(result.embeddedChunks, 2);
  assert.equal(harness.providerBatches.length, 0);
  assert.deepEqual(harness.calls.progress.map((call) => call.method), ['markCompleted']);
});

test('backfillDocument marks a document with no chunks as completed', async () => {
  const harness = createHarness({
    chunks: [],
    missingChunkIds: [],
    provider: { embedMany: async () => { throw new Error('should not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(result.totalChunks, 0);
  assert.deepEqual(harness.calls.progress.map((call) => call.method), ['markCompleted']);
});

test('backfillDocument records a failure and keeps the completed count', async () => {
  let calls = 0;
  const harness = createHarness({
    provider: {
      embedMany: async (texts) => {
        calls += 1;
        if (calls === 2) {
          throw new Error('provider down');
        }
        return texts.map(() => vec());
      }
    },
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2']
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.embeddedChunks, 1);
  assert.match(result.error, /provider down/);

  const failure = harness.progressCalls('markFailed')[0];
  assert.equal(failure.payload.completedChunkCount, 1);
  assert.match(failure.payload.lastError, /provider down/);
});

test('backfillDocument fails the document when a chunk disappears mid-write', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    upsertResult: () => null
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(harness.progressCalls('markFailed').length, 1);
});

test('backfillDocument rejects provider vectors with the wrong dimensions', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec(384)) }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.match(result.error, /dimensions/);
});

test('token usage is summed only when every request reported it', async () => {
  const harness = createHarness({
    provider: {
      embedManyWithUsage: async (texts) => ({
        embeddings: texts.map(() => vec()),
        usage: { totalTokens: 7 },
        usageAvailable: true
      })
    },
    batchSize: 2
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  const completion = harness.progressCalls('markCompleted')[0];
  assert.equal(completion.payload.tokenCount, 14);
  assert.equal(completion.payload.tokensAvailable, true);
});

test('a known partial token total is preserved and flagged unavailable', async () => {
  let calls = 0;
  const harness = createHarness({
    provider: {
      embedManyWithUsage: async (texts) => {
        calls += 1;
        return {
          embeddings: texts.map(() => vec()),
          usage: calls === 1 ? { totalTokens: 9 } : null,
          usageAvailable: calls === 1
        };
      }
    },
    batchSize: 1
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  const completion = harness.progressCalls('markCompleted')[0];
  assert.equal(completion.payload.tokenCount, 9, 'observed tokens are kept rather than discarded');
  assert.equal(completion.payload.tokensAvailable, false, 'an incomplete total is never reported as available');
});

test('every write runs inside a transaction with the shared client', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    batchSize: 3
  });

  await harness.runner.backfillDocument('doc-1');

  const transactionCalls = harness.calls.progress.map((call) => call.method);
  assert.deepEqual(transactionCalls, ['claimDocument', 'renewClaim', 'updateProgressCounts', 'markCompleted']);
  assert.equal(harness.progressCalls('claimDocument')[0].options.client, harness.fakeClient);
  assert.equal(harness.progressCalls('renewClaim')[0].options.client, harness.fakeClient);
  assert.equal(harness.progressCalls('updateProgressCounts')[0].options.client, harness.fakeClient);
  assert.equal(harness.progressCalls('markCompleted')[0].options.client, harness.fakeClient);
  assert.equal(harness.calls.chunkUpserts[0].options.client, harness.fakeClient);
});

test('run processes documents in order and returns a result per document', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const results = await harness.runner.run(['doc-1', 'doc-1']);

  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'completed');
  assert.equal(results[1].status, 'completed');
});

test('run rejects a non-array argument', async () => {
  const harness = createHarness({ provider: { embedMany: async () => [] } });

  await assert.rejects(() => harness.runner.run('doc-1'), ValidationError);
});

test('withTransaction commits on success and releases the client', async () => {
  const events = [];
  const client = {
    async query(sql) { events.push(sql); return { rows: [] }; },
    release() { events.push('release'); }
  };
  const pool = { async connect() { events.push('connect'); return client; } };

  const value = await withTransaction(pool, async (c) => {
    assert.equal(c, client);
    return 'ok';
  });

  assert.equal(value, 'ok');
  assert.deepEqual(events, [
    'connect',
    'BEGIN',
    "SET LOCAL lock_timeout = '5000ms'",
    "SET LOCAL statement_timeout = '30000ms'",
    "SET LOCAL idle_in_transaction_session_timeout = '30000ms'",
    'COMMIT',
    'release'
  ]);
});

test('withTransaction rolls back and rethrows when the body fails', async () => {
  const events = [];
  const client = {
    async query(sql) { events.push(sql); return { rows: [] }; },
    release() { events.push('release'); }
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(
    () => withTransaction(pool, async () => { throw new Error('boom'); }),
    /boom/
  );

  assert.deepEqual(events, [
    'BEGIN',
    "SET LOCAL lock_timeout = '5000ms'",
    "SET LOCAL statement_timeout = '30000ms'",
    "SET LOCAL idle_in_transaction_session_timeout = '30000ms'",
    'ROLLBACK',
    'release'
  ]);
});

test('withTransaction requires a pool with connect()', async () => {
  await assert.rejects(() => withTransaction({}, async () => {}), DatabaseError);
});

test('a chunk added during backfill cannot produce a false completion', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    verification: { totalChunks: 3, embeddedChunks: 2, missingChunks: 1, complete: false }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
  assert.equal(harness.progressCalls('markFailed').length, 1);
  assert.match(result.error, /refusing to mark it completed/);
});

test('a chunk removed or replaced during backfill cannot produce a false completion', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    verification: { totalChunks: 3, embeddedChunks: 2, missingChunks: 1, complete: false }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
  assert.match(harness.progressCalls('markFailed')[0].payload.lastError, /without a/);
});

test('missing embeddings are detected even when the total chunk counts happen to match', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    verification: { totalChunks: 2, embeddedChunks: 1, missingChunks: 1, complete: false }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.ok(harness.calls.verifications.length > 0, 'identity-based completeness verification must run');
  assert.equal(result.totalChunks, 2);
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

test('completion is verified against current state inside the same transaction as markCompleted', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  await harness.runner.backfillDocument('doc-1');

  const completed = harness.progressCalls('markCompleted')[0];
  const verification = harness.calls.verifications.at(-1);
  assert.equal(completed.options.client, harness.fakeClient);
  assert.ok(verification.complete);
  assert.equal(completed.payload.expectedChunkCount, verification.totalChunks);
  assert.equal(completed.payload.completedChunkCount, verification.embeddedChunks);
});

test('the document row lock is taken on the completion transaction before verification', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  await harness.runner.backfillDocument('doc-1');

  const locks = harness.calls.documentLocks;
  assert.ok(locks.length >= 1, 'the runner takes the document row lock');

  const lastLockIndex = harness.calls.events.findLastIndex((event) => event.type === 'documentLock');
  const verifyIndex = harness.calls.events.findIndex((event) => event.type === 'verification');
  assert.ok(lastLockIndex >= 0 && verifyIndex >= 0, 'both a document lock and verification were recorded');
  assert.ok(lastLockIndex < verifyIndex, 'the completion lock is acquired before verification runs');

  const completionLock = locks.at(-1);
  assert.equal(completionLock.documentId, 'doc-1');
  assert.equal(completionLock.options.client, harness.fakeClient, 'the lock uses the same transaction client as verification');
});

test('completion is refused when the document is gone by the time the lock is taken', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: [],
    document: { id: 'doc-1', status: 'ready' },
    documentLock: null,
    provider: { embedMany: async () => { throw new Error('should not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /was deleted before completion could be recorded/);
  assert.equal(harness.progressCalls('markCompleted').length, 0, 'nothing is marked completed without the lock');
});

test('a failure handler fenced out by a newer claim neither throws nor clobbers', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('provider down'); } },
    markFailed: null,
    getProgress: { status: 'in_progress' }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'skipped');
  assert.equal(harness.progressCalls('markFailed').length, 1);
  assert.equal(harness.progressCalls('markFailed')[0].payload.completedChunkCount, 0);
});

test('an already-completed document is not restarted when the claim is refused', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('should not be called'); } },
    claimDocument: null,
    getProgress: { status: 'completed' },
    verification: { totalChunks: 1, embeddedChunks: 1, missingChunks: 0, complete: true }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(result.embeddedChunks, 1);
  assert.equal(harness.providerBatches.length, 0);
});

test('a completed progress row with missing embeddings is reported and not silently completed', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('should not be called'); } },
    claimDocument: null,
    getProgress: { status: 'completed' },
    verification: { totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false },
    markFailed: null
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.match(result.error, /refusing to mark it completed/);
});

test('a failed document can be retried and then completed', async () => {
  let attempt = 0;
  const provider = {
    embedMany: async (texts) => {
      attempt += 1;

      if (attempt === 1) {
        throw new Error('first attempt fails');
      }

      return texts.map(() => vec());
    }
  };

  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider
  });

  const failed = await harness.runner.backfillDocument('doc-1');
  assert.equal(failed.status, 'failed');

  const retried = await harness.runner.backfillDocument('doc-1');
  assert.equal(retried.status, 'completed');
});

test('a failure inside a batch does not advance the committed progress count', async () => {
  let call = 0;
  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: {
      embedMany: async (texts) => {
        call += 1;

        if (call === 2) {
          throw new Error('second batch fails');
        }

        return texts.map(() => vec());
      }
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.embeddedChunks, 1);

  const updates = harness.progressCalls('updateProgressCounts');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.completedChunkCount, 1);
  assert.equal(harness.progressCalls('markFailed')[0].payload.completedChunkCount, 1);
});

test('construction rejects an out-of-range lease', () => {
  const base = {
    space: VOYAGE_SPACE,
    documentsRepository: { lockForUpdate: async () => ({ id: 'doc-1' }) },
    embeddingRepository: {},
    chunkEmbeddingRepository: {},
    embeddingBackfillProgressRepository: {},
    embeddingProvider: { embedMany: async () => [] }
  };

  assert.throws(() => createEmbeddingBackfillRunner({ ...base, leaseMs: 0 }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, leaseMs: -1 }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, leaseMs: 1.5 }), ValidationError);
  assert.throws(() => createEmbeddingBackfillRunner({ ...base, leaseMs: 60 * 60 * 1000 }), ValidationError);
});

test('the claim carries the lease and only the claimed attempt fences later writes', async () => {
  const harness = createHarness({
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  await harness.runner.backfillDocument('doc-1');

  const claim = harness.progressCalls('claimDocument')[0];
  assert.ok(claim.payload.leaseMs > 0, 'the claim presents a lease');
  assert.equal(harness.progressCalls('renewClaim')[0].payload.attempt, 1);
  assert.equal(harness.progressCalls('updateProgressCounts')[0].payload.attempt, 1);
  assert.equal(harness.progressCalls('markCompleted')[0].payload.attempt, 1);
});

test('a document held under a live lease is skipped without calling the provider', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('should not be called'); } },
    claimDocument: null,
    getProgress: { status: 'in_progress' }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /another worker/);
  assert.equal(harness.providerBatches.length, 0);
  assert.equal(harness.progressCalls('renewClaim').length, 0);
  assert.equal(harness.progressCalls('markFailed').length, 0);
});

test('losing the lease before a batch aborts before spending tokens on that batch', async () => {
  let renewals = 0;
  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    renewClaim: () => {
      renewals += 1;
      return renewals === 1 ? { status: 'in_progress', attempts: 1 } : null;
    },
    getProgress: { status: 'in_progress' }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /lease was taken over/);
  assert.equal(harness.providerBatches.length, 1, 'the fenced-out batch never reaches the provider');
  assert.deepEqual(harness.providerBatches[0], ['one']);
  assert.equal(harness.progressCalls('markFailed').length, 0, 'a fenced-out worker must not clobber newer progress');
});

test('a stale worker cannot write progress after a newer claim took over', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    updateProgressCounts: null,
    getProgress: { status: 'in_progress' }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /lease was taken over/);
  assert.equal(harness.progressCalls('markFailed').length, 0);
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

test('classifyBackfillError maps provider and database failures to bounded categories', () => {
  const rate = classifyBackfillError(new ProviderError('slow down', { statusCode: 429, retryable: true }));
  assert.equal(rate.category, 'rate_limit');
  assert.equal(rate.retryable, true);

  const auth = classifyBackfillError(new ProviderError('bad key', { statusCode: 401 }));
  assert.equal(auth.category, 'provider_permanent');
  assert.equal(auth.retryable, false);

  const server = classifyBackfillError(new ProviderError('boom', { statusCode: 503 }));
  assert.equal(server.category, 'provider_transient');
  assert.equal(server.retryable, true);

  const invalid = classifyBackfillError(new ValidationError('bad vector'));
  assert.equal(invalid.category, 'invalid_input');
  assert.equal(invalid.retryable, false);

  const lockTimeout = Object.assign(new DatabaseError('canceling statement due to lock timeout'), { code: '55P03' });
  assert.equal(classifyBackfillError(lockTimeout).category, 'db_timeout');
  assert.equal(classifyBackfillError(lockTimeout).retryable, true);

  const serialization = Object.assign(new DatabaseError('could not serialize'), { code: '40001' });
  assert.equal(classifyBackfillError(serialization).category, 'db_concurrency');

  const unknown = classifyBackfillError(new Error('mystery'));
  assert.equal(unknown.category, 'unknown');
  assert.equal(unknown.retryable, false);
});

test('a sanitised classification never leaks control characters or long bodies', () => {
  const noisy = new Error(`bad\n\tthing ${'x'.repeat(1000)}`);
  const classification = classifyBackfillError(noisy);

  assert.equal(classification.category, 'unknown');
  assert.equal(classification.sanitised.includes('\n'), false);
  assert.equal(classification.sanitised.includes('\t'), false);
  assert.ok(classification.sanitised.length <= 500);
});

test('provider_transient failures are classified as retryable and surfaced on the result', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: {
      embedMany: async () => {
        throw new ProviderError('upstream exploded', { statusCode: 503, retryable: true });
      }
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'provider_transient');
  assert.equal(result.retryable, true);
  assert.equal(harness.progressCalls('markFailed')[0].payload.attempt, 1);
});
test('a progress row deleted mid-flight (chunk replacement) is a state-changed failure', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    updateProgressCounts: null,
    getProgress: null
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'state_changed');
  assert.equal(result.retryable, true);
  assert.equal(harness.progressCalls('markFailed').length, 0, 'there is no row left to record a failure against');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

// ---------------------------------------------------------------------------
// Progress-read failures: a database read error must never be mistaken for a
// successful hand-off to another worker. The worker must fail closed with a
// sanitized, distinguishable result and leave every progress row untouched.
// ---------------------------------------------------------------------------

test('a progress-read failure before the first batch fails closed and is distinguishable', async () => {
  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('should not be called'); } },
    renewClaim: () => null,
    getProgress: () => { throw new Error('progress read exploded'); }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed', 'a read failure is a failure, not a takeover');
  assert.notEqual(result.status, 'skipped');
  assert.equal(result.category, 'ownership_unverified');
  assert.equal(result.retryable, true);
  assert.ok(typeof result.error === 'string' && result.error.length > 0);
  assert.ok(!result.error.includes('progress read exploded'), 'the raw read error is not leaked');
  assert.equal(harness.providerBatches.length, 0, 'no provider call is made after ownership is unresolved');
  assert.equal(harness.progressCalls('markFailed').length, 0, 'no progress write is attempted');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

test('a progress-read failure between two batches fails closed and stops spending', async () => {
  let renewals = 0;
  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    renewClaim: () => {
      renewals += 1;
      return renewals === 1 ? { status: 'in_progress', attempts: 1 } : null;
    },
    getProgress: () => { throw new Error('progress read exploded'); }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'ownership_unverified');
  assert.equal(result.retryable, true);
  assert.equal(harness.providerBatches.length, 1, 'the second batch never reaches the provider');
  assert.deepEqual(harness.providerBatches[0], ['one']);
  assert.equal(harness.progressCalls('markFailed').length, 0);
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

test('a progress-read failure during completion verification fails closed', async () => {
  let reads = 0;
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) },
    markCompleted: null,
    getProgress: () => {
      reads += 1;
      if (reads === 1) {
        return { status: 'in_progress' };
      }
      throw new Error('progress read exploded');
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'ownership_unverified');
  assert.equal(result.retryable, true);
  assert.equal(harness.progressCalls('markCompleted').length, 1, 'completion was attempted before fencing was confirmed');
  assert.equal(harness.progressCalls('markFailed').length, 0, 'an unresolved owner must not overwrite progress');
});

test('a progress-read failure after a refused failure-write fails closed', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: {
      embedMany: async () => {
        throw new ProviderError('upstream exploded', { statusCode: 503, retryable: true });
      }
    },
    markFailed: null,
    getProgress: () => { throw new Error('progress read exploded'); }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.category, 'ownership_unverified');
  assert.equal(result.retryable, true);
  assert.equal(harness.providerBatches.length, 1);
  assert.equal(harness.progressCalls('markFailed').length, 1, 'the fenced failure write was attempted');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
});

// ---------------------------------------------------------------------------
// Partial usage accounting: successful usage must survive later failures, be
// flagged incomplete when any request omits it, never be double-counted on
// resume, and never be invented for a request that did not report it.
// ---------------------------------------------------------------------------

test('a later failed batch preserves the token usage already reported', async () => {
  let calls = 0;
  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: {
      embedManyWithUsage: async (texts) => {
        calls += 1;

        if (calls === 2) {
          throw new ProviderError('permanent failure', { statusCode: 400 });
        }

        return {
          embeddings: texts.map(() => vec()),
          usage: { totalTokens: 11 },
          usageAvailable: true
        };
      }
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
  const failure = harness.progressCalls('markFailed')[0];
  assert.equal(failure.payload.tokenCount, 11, 'the successful batch usage is preserved on failure');
  assert.equal(failure.payload.tokensAvailable, true);
  assert.equal(failure.payload.completedChunkCount, 1);
});

test('a run where no request reports usage stores zero tokens flagged unavailable', async () => {
  const harness = createHarness({
    provider: {
      embedManyWithUsage: async (texts) => ({
        embeddings: texts.map(() => vec()),
        usage: null,
        usageAvailable: false
      })
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  const completion = harness.progressCalls('markCompleted')[0];
  assert.equal(completion.payload.tokenCount, 0);
  assert.equal(completion.payload.tokensAvailable, false, 'zero is never reported as a complete total');
});

test('resuming after a partial run never re-spends tokens on already-embedded chunks', async () => {
  let call = 0;
  const firstSeen = [];
  const first = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: {
      embedManyWithUsage: async (texts) => {
        call += 1;
        firstSeen.push(texts.slice());

        if (call === 2) {
          throw new ProviderError('transient', { statusCode: 503, retryable: true });
        }

        return { embeddings: texts.map(() => vec()), usage: { totalTokens: 3 }, usageAvailable: true };
      }
    }
  });

  const firstResult = await first.runner.backfillDocument('doc-1');
  assert.equal(firstResult.status, 'failed');
  assert.deepEqual(firstSeen, [['one'], ['two']], 'the first run only ever sends each chunk once');

  // A later run inspects the store and finds only the second chunk still missing.
  const second = createHarness({
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c2'],
    provider: {
      embedManyWithUsage: async (texts) => ({
        embeddings: texts.map(() => vec()),
        usage: { totalTokens: 3 },
        usageAvailable: true
      })
    }
  });

  const secondResult = await second.runner.backfillDocument('doc-1');
  assert.equal(secondResult.status, 'completed');
  assert.deepEqual(second.providerBatches, [['two']], 'the already-embedded chunk is not re-sent');
  assert.equal(second.progressCalls('markCompleted')[0].payload.tokenCount, 3, 'only the newly embedded chunk is counted');
});

// ---------------------------------------------------------------------------
// Lease-timing and transaction-boundary safety: a renewal that itself errors
// must abort before spending tokens, and provider calls must never run while a
// database transaction is open.
// ---------------------------------------------------------------------------

test('a lease-renewal error aborts the batch before any provider call', async () => {
  const harness = createHarness({
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    renewClaim: () => { throw new DatabaseError('renewal read failed'); },
    provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(harness.providerBatches.length, 0, 'no tokens are spent after a renewal error');
  assert.equal(harness.progressCalls('markCompleted').length, 0);
  const failure = harness.progressCalls('markFailed')[0];
  assert.equal(failure.payload.attempt, 1, 'the failure is recorded against the current claim');
});

test('provider calls are never dispatched while a transaction is open', async () => {
  let inTransaction = 0;
  let providerCalledInTransaction = false;

  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    runInTransaction: async (fn) => {
      inTransaction += 1;

      try {
        return await fn({ query: async () => ({ rows: [] }) });
      } finally {
        inTransaction -= 1;
      }
    },
    provider: {
      embedManyWithUsage: async (texts) => {
        if (inTransaction > 0) {
          providerCalledInTransaction = true;
        }

        return { embeddings: texts.map(() => vec()), usage: { totalTokens: 1 }, usageAvailable: true };
      }
    }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(harness.providerBatches.length, 2, 'both batches were embedded');
  assert.equal(providerCalledInTransaction, false, 'the provider is only ever called outside the transaction');
});

// ---------------------------------------------------------------------------
// Stage 3G Step 2: document eligibility (general runner vs operator path)
// ---------------------------------------------------------------------------

test('backfillDocument returns ineligible without touching the provider for non-embeddable statuses', async () => {
  for (const status of ['failed', 'uploaded', 'extracting', 'ocr', 'chunking', 'queued', 'bogus']) {
    const harness = createHarness({
      document: { id: 'doc-1', status },
      chunks: [{ id: 'c1', content: 'one' }],
      missingChunkIds: ['c1'],
      provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
    });

    const result = await harness.runner.backfillDocument('doc-1');

    assert.equal(result.status, 'ineligible', `status "${status}" must be ineligible`);
    assert.equal(result.reason, 'document_status_ineligible', `stable reason for "${status}"`);
    assert.equal(result.documentStatus, status);
    assert.equal(harness.providerBatches.length, 0, `no tokens are spent for "${status}"`);
    assert.equal(harness.progressCalls('claimDocument').length, 0, `no claim is taken for "${status}"`);
    assert.equal(harness.progressCalls('markCompleted').length, 0);
  }
});

test('backfillDocument returns ineligible when a document has no status at all', async () => {
  const harness = createHarness({
    document: { id: 'doc-1' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'ineligible');
  assert.equal(result.reason, 'document_status_ineligible');
  assert.equal(result.documentStatus, null);
  assert.equal(harness.providerBatches.length, 0);
});

test('backfillDocument reports a missing document without calling the provider', async () => {
  const harness = createHarness({
    document: null,
    provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'missing');
  assert.equal(result.embeddedChunks, 0);
  assert.equal(result.totalChunks, 0);
  assert.equal(harness.providerBatches.length, 0);
});

test('backfillDocument still embeds a document in the embedding state (inline ingestion/re-embed)', async () => {
  const harness = createHarness({
    document: { id: 'doc-1', status: 'embedding' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(harness.providerBatches.length, 1);
  assert.equal(harness.progressCalls('markCompleted').length, 1);
});

test('an operator-policy runner refuses the embedding state but allows ready', async () => {
  const blocked = createHarness({
    eligibilityPolicy: 'operator',
    document: { id: 'doc-1', status: 'embedding' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
  });

  const blockedResult = await blocked.runner.backfillDocument('doc-1');
  assert.equal(blockedResult.status, 'ineligible');
  assert.equal(blockedResult.reason, 'document_status_ineligible');
  assert.equal(blockedResult.documentStatus, 'embedding');
  assert.equal(blocked.providerBatches.length, 0);

  const allowed = createHarness({
    eligibilityPolicy: 'operator',
    document: { id: 'doc-1', status: 'ready' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const allowedResult = await allowed.runner.backfillDocument('doc-1');
  assert.equal(allowedResult.status, 'completed');
  assert.equal(allowed.providerBatches.length, 1);
});

test('construction rejects an unknown eligibility policy', () => {
  assert.throws(
    () => createEmbeddingBackfillRunner({
      space: VOYAGE_SPACE,
      documentsRepository: {},
      embeddingRepository: {},
      chunkEmbeddingRepository: {},
      embeddingBackfillProgressRepository: {},
      embeddingProvider: { embedMany: async () => [] },
      eligibilityPolicy: 'migration'
    }),
    ValidationError
  );
});

test('a document that becomes ineligible before the claim is not embedded', async () => {
  const doc = { id: 'doc-1', status: 'ready' };
  let locks = 0;

  const harness = createHarness({
    document: doc,
    documentLock: () => {
      locks += 1;
      doc.status = 'failed';
      return doc;
    },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1'],
    provider: { embedMany: async () => { throw new Error('the provider must not be called'); } }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'ineligible');
  assert.equal(result.reason, 'document_status_ineligible');
  assert.equal(result.documentStatus, 'failed');
  assert.equal(locks, 1, 'only the claim-time lock was taken');
  assert.equal(harness.providerBatches.length, 0);
  assert.equal(harness.progressCalls('claimDocument').length, 0, 'no claim is taken for an ineligible document');
});

test('a document that becomes ineligible between batches stops before the next provider call', async () => {
  const doc = { id: 'doc-1', status: 'ready' };
  let locks = 0;

  const harness = createHarness({
    document: doc,
    documentLock: () => {
      locks += 1;
      // lock #1 = claim gate, #2 = first batch gate, #3 = second batch gate.
      if (locks === 3) {
        doc.status = 'failed';
      }
      return doc;
    },
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'ineligible');
  assert.equal(result.documentStatus, 'failed');
  assert.equal(result.embeddedChunks, 1, 'the first batch was already committed');
  assert.equal(harness.providerBatches.length, 1, 'only the first batch reached the provider');
  assert.equal(harness.progressCalls('markCompleted').length, 0, 'no completion is published');
  assert.equal(harness.progressCalls('claimDocument').length, 1);
});

test('a stale worker whose renewed claim is refused cannot publish completion', async () => {
  let renewals = 0;

  const harness = createHarness({
    batchSize: 1,
    chunks: [{ id: 'c1', content: 'one' }, { id: 'c2', content: 'two' }],
    missingChunkIds: ['c1', 'c2'],
    renewClaim: () => {
      renewals += 1;
      // First batch renews fine; a newer claim took over before the second.
      return renewals === 1 ? { status: 'in_progress' } : null;
    },
    getProgress: { status: 'in_progress' },
    provider: { embedMany: async (texts) => texts.map(() => vec()) }
  });

  const result = await harness.runner.backfillDocument('doc-1');

  assert.equal(result.status, 'skipped');
  assert.equal(harness.providerBatches.length, 1, 'the second batch is never dispatched');
  assert.equal(harness.progressCalls('markCompleted').length, 0, 'a stale worker never publishes completion');
});
