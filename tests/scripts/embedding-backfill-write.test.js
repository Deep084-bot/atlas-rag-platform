import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_DOCUMENTS_PER_RUN,
  WRITE_DB_ENV,
  WRITE_ELIGIBILITY_POLICY,
  parseWriteArgs,
  resolveWriteTarget,
  createMeteredProvider,
  createWriteRunner,
  runWriteBackfill,
  runWritePreview,
  main
} from '../../scripts/dev/embedding-backfill-write.mjs';
import { REQUIRED_SCHEMA_TABLES } from '../../scripts/dev/embedding-backfill.mjs';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';

function vec(dimensions = VOYAGE_SPACE.dimensions) {
  return Array.from({ length: dimensions }, () => 0.01);
}

function emptySnapshot() {
  return { embeddings: new Map(), statuses: new Map(), orphanedCount: 0, duplicateCount: 0 };
}

function createMeter(sequence) {
  let index = 0;

  return {
    calls: 0,
    snapshot() {
      const value = sequence[Math.min(index, sequence.length - 1)];
      index += 1;
      this.calls += 1;
      return value;
    }
  };
}

function createAuditor({ before = emptySnapshot(), after = emptySnapshot(), completeness = {}, progress = {} } = {}) {
  let index = 0;
  const snapshots = [before, after];

  return {
    async snapshot() {
      const value = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return value;
    },
    async verifyCompleteness(documentId) {
      return completeness[documentId] ?? { totalChunks: 1, embeddedChunks: 1, missingChunks: 0, complete: true };
    },
    async readProgress(documentId) {
      return progress[documentId] ?? null;
    }
  };
}

function createEnumerate(ids) {
  const calls = [];

  return {
    calls,
    async enumerate({ limit, afterId }) {
      calls.push({ limit, afterId });
      const start = afterId === null ? 0 : ids.indexOf(afterId) + 1;
      return ids.slice(start, start + limit).map((id) => ({ documentId: id, status: 'ready' }));
    }
  };
}

function createRunner(results) {
  const calls = [];
  let index = 0;

  return {
    calls,
    async planDocument(id) {
      return { documentId: id, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false };
    },
    async backfillDocument(id) {
      calls.push(id);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;

      if (typeof result === 'function') {
        return result(id);
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    }
  };
}

const completedResult = { status: 'completed', embeddedChunks: 1, totalChunks: 1 };

// ---------------------------------------------------------------------------
// Argument parsing and authorization
// ---------------------------------------------------------------------------

test('parseWriteArgs defaults to a one-document read-only preview', () => {
  const args = parseWriteArgs([]);
  assert.equal(args.write, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.limit, 1);
  assert.deepEqual(args.allowDatabases, []);
});

test('parseWriteArgs enables write mode with --write', () => {
  const args = parseWriteArgs(['--write']);
  assert.equal(args.write, true);
  assert.equal(args.dryRun, false);
});

test('parseWriteArgs rejects --write combined with --dry-run', () => {
  assert.throws(() => parseWriteArgs(['--write', '--dry-run']), /mutually exclusive/i);
});

test('parseWriteArgs rejects unknown arguments', () => {
  assert.throws(() => parseWriteArgs(['--nope']), /Unknown argument/i);
});

test('parseWriteArgs enforces the batch bound', () => {
  assert.throws(() => parseWriteArgs(['--write', '--limit', '0']), /positive integer/i);
  assert.throws(() => parseWriteArgs(['--write', '--limit', String(MAX_DOCUMENTS_PER_RUN + 1)]), /at most/i);
  assert.equal(parseWriteArgs(['--write', '--limit', String(MAX_DOCUMENTS_PER_RUN)]).limit, MAX_DOCUMENTS_PER_RUN);
});

test('parseWriteArgs collects repeatable --allow-database', () => {
  const args = parseWriteArgs(['--write', '--allow-database', 'a', '--allow-database', 'b']);
  assert.deepEqual(args.allowDatabases, ['a', 'b']);
});

test('resolveWriteTarget refuses write mode without an explicit allowlist entry', () => {
  assert.throws(
    () => resolveWriteTarget({
      args: { write: true, databaseUrl: 'postgresql:///atlas_backfill_test?host=/tmp', allowDatabases: [] },
      env: {}
    }),
    /not explicitly allowlisted/i
  );
});

test('resolveWriteTarget authorizes write mode only for the exact allowlisted name', () => {
  const target = resolveWriteTarget({
    args: {
      write: true,
      databaseUrl: 'postgresql:///atlas_backfill_test?host=/tmp',
      allowDatabases: ['atlas_backfill_test']
    },
    env: {}
  });

  assert.equal(target.database, 'atlas_backfill_test');
  assert.equal(target.allowlisted, true);
});

test('resolveWriteTarget allows an unallowlisted disposable preview', () => {
  const target = resolveWriteTarget({
    args: { write: false, databaseUrl: 'postgresql:///atlas_backfill_test?host=/tmp', allowDatabases: [] },
    env: {}
  });

  assert.equal(target.database, 'atlas_backfill_test');
});

test('resolveWriteTarget inherits the remote-host refusal', () => {
  assert.throws(
    () => resolveWriteTarget({
      args: { write: false, databaseUrl: 'postgresql://db.example.com/atlas_backfill_test', allowDatabases: [] },
      env: {}
    }),
    /not local/i
  );
});

test('resolveWriteTarget refuses staging-looking names unless explicitly allowlisted', () => {
  assert.throws(
    () => resolveWriteTarget({
      args: { write: false, databaseUrl: 'postgresql:///atlas_staging?host=/tmp', allowDatabases: [] },
      env: {}
    }),
    /staging or production/i
  );

  const allowed = resolveWriteTarget({
    args: { write: true, databaseUrl: 'postgresql:///atlas_staging?host=/tmp', allowDatabases: ['atlas_staging'] },
    env: {}
  });
  assert.equal(allowed.allowlisted, true);
});

test('resolveWriteTarget refuses production-patterned names even when allowlisted', () => {
  assert.throws(
    () => resolveWriteTarget({
      args: { write: true, databaseUrl: 'postgresql:///atlas_prod?host=/tmp', allowDatabases: ['atlas_prod'] },
      env: {}
    }),
    /staging or production/i
  );
});

test('resolveWriteTarget inherits the DATABASE_URL equality refusal', () => {
  const raw = 'postgresql:///atlas_backfill_test?host=/tmp';

  assert.throws(
    () => resolveWriteTarget({
      args: { write: true, databaseUrl: raw, allowDatabases: ['atlas_backfill_test'] },
      env: { DATABASE_URL: raw }
    }),
    /identical to DATABASE_URL/i
  );
});

test('resolveWriteTarget falls back to the dedicated write env var', () => {
  const target = resolveWriteTarget({
    args: { write: true, allowDatabases: ['atlas_backfill_test'] },
    env: { [WRITE_DB_ENV]: 'postgresql:///atlas_backfill_test?host=/tmp' }
  });

  assert.equal(target.database, 'atlas_backfill_test');
});

// ---------------------------------------------------------------------------
// Provider metering
// ---------------------------------------------------------------------------

test('createMeteredProvider counts dispatches and accumulates reported usage', async () => {
  const meter = createMeteredProvider({
    async embedManyWithUsage(texts) {
      return { embeddings: texts.map(() => vec()), usage: { totalTokens: 7 }, usageAvailable: true };
    }
  });

  await meter.provider.embedManyWithUsage(['a', 'b']);
  await meter.provider.embedManyWithUsage(['c']);

  const snapshot = meter.snapshot();
  assert.equal(snapshot.dispatches, 2);
  assert.equal(snapshot.totalTokens, 14);
  assert.equal(snapshot.allUsageAvailable, true);
});

test('createMeteredProvider marks usage unavailable when a dispatch omits it', async () => {
  const meter = createMeteredProvider({
    async embedMany(texts) {
      return texts.map(() => vec());
    }
  });

  await meter.provider.embedMany(['a']);

  const snapshot = meter.snapshot();
  assert.equal(snapshot.dispatches, 1);
  assert.equal(snapshot.allUsageAvailable, false);
});

test('createMeteredProvider rejects a provider with no embedding method', () => {
  assert.throws(() => createMeteredProvider({}), /embedMany/);
});

// ---------------------------------------------------------------------------
// Operator eligibility policy is wired explicitly into the runner
// ---------------------------------------------------------------------------

function writeRunnerHarness({ document, chunks, missingChunkIds }) {
  const providerCalls = [];

  const documentsRepository = {
    async getDocumentById() {
      return document;
    },
    async lockForUpdate() {
      return document ? { id: document.id } : null;
    }
  };

  const embeddingRepository = {
    async countTotalChunks() {
      return chunks.length;
    },
    async getChunksForDocument() {
      return chunks;
    }
  };

  const chunkEmbeddingRepository = {
    async findChunkIdsMissingEmbedding() {
      return missingChunkIds;
    },
    async isDocumentFullyEmbedded() {
      return { totalChunks: chunks.length, embeddedChunks: chunks.length, missingChunks: 0, complete: true };
    },
    async upsertChunkEmbedding({ chunkId, spaceId }) {
      return { chunkId, spaceId };
    }
  };

  const embeddingBackfillProgressRepository = {
    async claimDocument(payload) {
      return { ...payload, status: 'in_progress', attempts: 1 };
    },
    async renewClaim(payload) {
      return { ...payload, status: 'in_progress' };
    },
    async updateProgressCounts(payload) {
      return { ...payload };
    },
    async markCompleted(payload) {
      return { ...payload, status: 'completed' };
    },
    async markFailed(payload) {
      return { ...payload, status: 'failed' };
    },
    async getProgress() {
      return null;
    }
  };

  const embeddingProvider = {
    async embedManyWithUsage(texts) {
      providerCalls.push(texts.slice());
      return { embeddings: texts.map(() => vec()), usage: { totalTokens: 5 }, usageAvailable: true };
    }
  };

  const runner = createWriteRunner({
    pool: null,
    embeddingProvider,
    repositories: {
      documentsRepository,
      embeddingRepository,
      chunkEmbeddingRepository,
      embeddingBackfillProgressRepository
    },
    runInTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    logger: { error() {} }
  });

  return { runner, providerCalls };
}

test('the write runner uses the explicit operator policy: non-ready rejected with zero dispatches', async () => {
  const { runner, providerCalls } = writeRunnerHarness({
    document: { id: 'doc-1', status: 'embedding' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1']
  });

  const result = await runner.backfillDocument('doc-1');

  assert.equal(result.status, 'ineligible');
  assert.equal(result.reason, 'document_status_ineligible');
  assert.equal(providerCalls.length, 0, 'a non-ready document never reaches the provider');
});

test('the write runner uses the explicit operator policy: ready document is embedded', async () => {
  const { runner, providerCalls } = writeRunnerHarness({
    document: { id: 'doc-1', status: 'ready' },
    chunks: [{ id: 'c1', content: 'one' }],
    missingChunkIds: ['c1']
  });

  const result = await runner.backfillDocument('doc-1');

  assert.equal(result.status, 'completed');
  assert.equal(providerCalls.length, 1);
});

test('WRITE_ELIGIBILITY_POLICY is the operator policy', () => {
  assert.equal(WRITE_ELIGIBILITY_POLICY, 'operator');
});

// ---------------------------------------------------------------------------
// runWriteBackfill: bounds, stop conditions, and accounting
// ---------------------------------------------------------------------------

test('runWriteBackfill defaults to a single document per run', async () => {
  const { enumerate, calls } = createEnumerate(['a', 'b']);
  const runner = createRunner([completedResult]);
  const meter = createMeter([
    { dispatches: 0, totalTokens: 0, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 9, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 9, allUsageAvailable: true }
  ]);

  const report = await runWriteBackfill({
    enumerate,
    runner,
    auditor: createAuditor(),
    meter
  });

  assert.equal(report.attemptedDocuments, 1);
  assert.equal(runner.calls.length, 1);
  assert.equal(report.truncated, true, 'more ready documents remain beyond the default limit');
  assert.equal(report.providerDispatches, 1);
  assert.equal(report.tokens, 9);
  assert.equal(report.usageAvailable, true);
  assert.equal(report.allSuccessful, true);
  assert.ok(calls.length >= 1);
});

test('runWriteBackfill rejects a batch above the strict maximum', async () => {
  await assert.rejects(
    () => runWriteBackfill({
      enumerate: createEnumerate(['a']).enumerate,
      runner: createRunner([completedResult]),
      auditor: createAuditor(),
      meter: createMeter([{ dispatches: 0, totalTokens: 0, allUsageAvailable: true }]),
      limit: MAX_DOCUMENTS_PER_RUN + 1
    }),
    /at most/i
  );
});

test('runWriteBackfill stops on provider failure and never retries the document', async () => {
  const { enumerate } = createEnumerate(['a', 'b']);
  const runner = createRunner([
    { status: 'failed', category: 'provider_transient', retryable: true, error: 'boom' }
  ]);
  const meter = createMeter([
    { dispatches: 0, totalTokens: 0, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 0, allUsageAvailable: false },
    { dispatches: 1, totalTokens: 0, allUsageAvailable: false }
  ]);

  const report = await runWriteBackfill({
    enumerate,
    runner,
    auditor: createAuditor(),
    meter,
    limit: 2
  });

  assert.equal(runner.calls.length, 1, 'the failed document is not retried and the next is not started');
  assert.equal(report.attemptedDocuments, 1);
  assert.equal(report.failedDocuments, 1);
  assert.equal(report.completedDocuments, 0);
  assert.equal(report.stoppedEarly, true);
  assert.equal(report.stopReason, 'provider_transient');
  assert.equal(report.allSuccessful, false);
});

test('runWriteBackfill reports incomplete usage as unavailable, not zero', async () => {
  const { enumerate } = createEnumerate(['a']);
  const runner = createRunner([completedResult]);
  const meter = createMeter([
    { dispatches: 0, totalTokens: 0, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 0, allUsageAvailable: false },
    { dispatches: 1, totalTokens: 0, allUsageAvailable: false }
  ]);

  const report = await runWriteBackfill({ enumerate, runner, auditor: createAuditor(), meter });

  assert.equal(report.tokens, null, 'unknown usage is reported as unavailable, never zero');
  assert.equal(report.usageAvailable, false);
  assert.equal(report.documents[0].tokens, null);
});

test('runWriteBackfill aborts on identity mismatch before any mutation', async () => {
  const { enumerate } = createEnumerate(['a']);
  const runner = createRunner([completedResult]);

  const report = await runWriteBackfill({
    enumerate,
    runner,
    auditor: createAuditor(),
    meter: createMeter([{ dispatches: 0, totalTokens: 0, allUsageAvailable: true }]),
    revalidateIdentity: async () => {
      throw new Error('connected to database "other"');
    }
  });

  assert.equal(runner.calls.length, 0, 'the runner is never invoked');
  assert.equal(report.attemptedDocuments, 0);
  assert.equal(report.anomalies[0].type, 'identity_mismatch');
  assert.equal(report.allSuccessful, false);
});

test('runWriteBackfill reports an interruption honestly and stops scheduling work', async () => {
  const { enumerate } = createEnumerate(['a', 'b']);
  const runner = createRunner([completedResult]);
  const meter = createMeter([
    { dispatches: 0, totalTokens: 0, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 4, allUsageAvailable: true },
    { dispatches: 1, totalTokens: 4, allUsageAvailable: true }
  ]);

  let stopChecks = 0;

  const report = await runWriteBackfill({
    enumerate,
    runner,
    auditor: createAuditor(),
    meter,
    limit: 2,
    shouldStop: () => {
      stopChecks += 1;
      return stopChecks > 1;
    }
  });

  assert.equal(runner.calls.length, 1);
  assert.equal(report.attemptedDocuments, 1);
  assert.equal(report.completedDocuments, 1);
  assert.equal(report.stoppedEarly, true);
  assert.equal(report.stopReason, 'interrupted');
  assert.equal(report.allSuccessful, false);
});

test('runWriteBackfill flags an unrelated document change as a failure', async () => {
  const { enumerate } = createEnumerate(['a']);
  const runner = createRunner([completedResult]);
  const before = new Map([['other', 1]]);
  const after = new Map([['other', 2]]);

  const report = await runWriteBackfill({
    enumerate,
    runner,
    auditor: createAuditor({
      before: { embeddings: before, statuses: new Map(), orphanedCount: 0, duplicateCount: 0 },
      after: { embeddings: after, statuses: new Map(), orphanedCount: 0, duplicateCount: 0 }
    }),
    meter: createMeter([
      { dispatches: 0, totalTokens: 0, allUsageAvailable: true },
      { dispatches: 1, totalTokens: 1, allUsageAvailable: true },
      { dispatches: 1, totalTokens: 1, allUsageAvailable: true }
    ])
  });

  assert.equal(report.unrelatedDocumentChanges.embeddings.length, 1);
  assert.equal(report.allSuccessful, false);
});

// ---------------------------------------------------------------------------
// Preview: no writes
// ---------------------------------------------------------------------------

test('runWritePreview performs no writes and uses only planDocument', async () => {
  const { enumerate } = createEnumerate(['a', 'b']);
  let backfillCalls = 0;

  const runner = {
    async planDocument(id) {
      return { documentId: id, totalChunks: 2, embeddedChunks: 1, missingChunks: 1, complete: false };
    },
    async backfillDocument() {
      backfillCalls += 1;
      throw new Error('preview must not write');
    }
  };

  const report = await runWritePreview({ enumerate, runner, limit: 1 });

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.readOnly, true);
  assert.equal(report.eligibleDocuments, 1);
  assert.equal(report.truncated, true);
  assert.equal(backfillCalls, 0);
});

// ---------------------------------------------------------------------------
// main(): preview, authorization, wiring
// ---------------------------------------------------------------------------

function createMockPool({ database = 'atlas_write_test', serverAddr = null } = {}) {
  const pool = {
    ended: 0,
    async query(sql) {
      const text = String(sql).trim();

      if (text.toLowerCase().startsWith('select current_database()')) {
        return { rows: [{ database, server_addr: serverAddr }] };
      }

      if (text.includes('to_regclass')) {
        return { rows: REQUIRED_SCHEMA_TABLES.map((entry) => ({ name: entry.name, present: true })) };
      }

      return { rows: [] };
    },
    async end() {
      this.ended += 1;
    }
  };

  return pool;
}

test('main previews with no writes and exits 0 without constructing a write runner', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool();
  let writeRunnerBuilt = false;

  const res = await main({
    argv: ['--json', '--database-url', 'postgresql:///atlas_write_test?host=/tmp', '--limit', '2'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ limit, afterId }) => {
          if (afterId === null) return [{ documentId: 'd1', status: 'ready' }];
          return [];
        }
      }),
      createPreviewRunner: () => ({
        planDocument: async (id) => ({ documentId: id, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false })
      }),
      createRunner: () => {
        writeRunnerBuilt = true;
        return { backfillDocument: async () => completedResult };
      },
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      installSignalHandlers: () => () => {}
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(writeRunnerBuilt, false);
  assert.equal(err.length, 0);
  const report = JSON.parse(out.join(''));
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.readOnly, true);
  assert.equal(pool.ended, 1);
});

test('main refuses write mode without an explicit allowlist and never opens a pool', async () => {
  const out = [];
  const err = [];
  let poolBuilt = false;

  const res = await main({
    argv: ['--write', '--database-url', 'postgresql:///atlas_write_test?host=/tmp'],
    env: {},
    deps: {
      createPool: () => {
        poolBuilt = true;
        return createMockPool();
      },
      write: (text) => out.push(text),
      writeError: (text) => err.push(text)
    }
  });

  assert.equal(res.exitCode, 1);
  assert.equal(poolBuilt, false);
  assert.match(err.join(''), /not explicitly allowlisted/i);
  assert.equal(out.length, 0);
});

test('main performs a bounded successful write and reports usage', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool();
  const runnerCalls = [];
  let meteredProvider = null;

  const res = await main({
    argv: [
      '--write',
      '--database-url', 'postgresql:///atlas_write_test?host=/tmp',
      '--allow-database', 'atlas_write_test',
      '--limit', '1',
      '--json'
    ],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ limit, afterId }) => {
          if (afterId === null) return [{ documentId: 'd1', status: 'ready' }];
          return [];
        }
      }),
      createProvider: () => ({
        async embedManyWithUsage(texts) {
          return { embeddings: texts.map(() => vec()), usage: { totalTokens: 12 }, usageAvailable: true };
        }
      }),
      createRunner: (options) => {
        meteredProvider = options.embeddingProvider;
        return {
          planDocument: async (id) => ({ documentId: id, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false }),
          backfillDocument: async (id) => {
            runnerCalls.push(id);
            return completedResult;
          }
        };
      },
      createAuditor: () => createAuditor({
        completeness: { d1: { totalChunks: 1, embeddedChunks: 1, missingChunks: 0, complete: true } },
        progress: { d1: { status: 'completed', tokensAvailable: false, tokenCount: 0 } }
      }),
      readDocument: () => async (id) => ({ id, status: 'ready' }),
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      installSignalHandlers: () => () => {}
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(err.length, 0);
  assert.deepEqual(runnerCalls, ['d1']);
  assert.equal(typeof meteredProvider?.embedManyWithUsage, 'function', 'main wires a metered provider into the runner');
  const report = JSON.parse(out.join(''));
  assert.equal(report.mode, 'write');
  assert.equal(report.allSuccessful, true);
  assert.equal(report.completedDocuments, 1);
});

test('main refuses write mode when identity revalidation fails', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool();
  let runnerCalls = 0;

  const res = await main({
    argv: ['--write', '--database-url', 'postgresql:///atlas_write_test?host=/tmp', '--allow-database', 'atlas_write_test'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ afterId }) => (afterId === null ? [{ documentId: 'd1', status: 'ready' }] : [])
      }),
      createProvider: () => ({ embedManyWithUsage: async (texts) => ({ embeddings: texts.map(() => vec()), usage: { totalTokens: 1 }, usageAvailable: true }) }),
      createRunner: () => ({
        planDocument: async () => ({ totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false }),
        backfillDocument: async () => {
          runnerCalls += 1;
          return completedResult;
        }
      }),
      createAuditor: () => createAuditor(),
      readDocument: () => async (id) => ({ id, status: 'ready' }),
      verifyTarget: async () => {
        throw new Error('connected to database "somewhere_else"');
      },
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      installSignalHandlers: () => () => {}
    }
  });

  assert.equal(res.exitCode, 1);
  assert.equal(runnerCalls, 0);
  assert.match(err.join(''), /somewhere_else/i);
});

test('main exits 2 and does not retry when a document fails', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool();
  const runnerCalls = [];

  const res = await main({
    argv: ['--write', '--database-url', 'postgresql:///atlas_write_test?host=/tmp', '--allow-database', 'atlas_write_test', '--limit', '2', '--json'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ afterId }) => {
          if (afterId === null) return [{ documentId: 'd1', status: 'ready' }];
          if (afterId === 'd1') return [{ documentId: 'd2', status: 'ready' }];
          return [];
        }
      }),
      createProvider: () => ({ embedManyWithUsage: async (texts) => ({ embeddings: texts.map(() => vec()), usage: { totalTokens: 1 }, usageAvailable: true }) }),
      createRunner: () => ({
        planDocument: async () => ({ totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false }),
        backfillDocument: async (id) => {
          runnerCalls.push(id);
          return { status: 'failed', category: 'provider_transient', retryable: true, error: 'boom' };
        }
      }),
      createAuditor: () => createAuditor(),
      readDocument: () => async (id) => ({ id, status: 'ready' }),
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      installSignalHandlers: () => () => {}
    }
  });

  assert.equal(res.exitCode, 2);
  assert.deepEqual(runnerCalls, ['d1'], 'the failed document is not retried and d2 is not started');
  const report = JSON.parse(out.join(''));
  assert.equal(report.stoppedEarly, true);
  assert.equal(report.allSuccessful, false);
});
