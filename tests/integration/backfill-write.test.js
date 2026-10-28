import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Client } from 'pg';

import { main } from '../../scripts/dev/embedding-backfill-write.mjs';
import { HOSTED_BGE_SPACE_ID, VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ProviderError } from '../../server/errors.js';
import {
  INTEGRATION_DB_ENV,
  applySchema,
  createIntegrationPool,
  insertChunk,
  insertChunkEmbedding,
  insertDocument,
  resolveIntegrationTarget,
  vector,
  verifyIntegrationTarget
} from './lib/backfill-harness.js';

/**
 * End-to-end test for the operator WRITE-mode embedding backfill against a real
 * disposable local PostgreSQL database.
 *
 * The file creates its own dedicated disposable database (derived from the
 * configured base target) so it never shares schema state with other integration
 * files when `node --test` runs files in parallel. The embedding provider is
 * always a local stub — no external provider is ever contacted — but every other
 * layer (target guard, schema preflight, repositories, transactions, upserts and
 * progress bookkeeping) is the real production code path.
 *
 * Skipped unless `ATLAS_BACKFILL_INTEGRATION_DATABASE_URL` points at a disposable
 * local database.
 */

const SPACE_ID = VOYAGE_SPACE.id;
const BGE_SPACE = HOSTED_BGE_SPACE_ID;

let baseTarget = null;
let configError = null;

try {
  baseTarget = resolveIntegrationTarget();
} catch (error) {
  configError = error;
}

let pool = null;
let adminClient = null;
let createdDatabase = null;
let skipReason = null;

function deriveConnectionString(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function assertSafeIdentifier(name) {
  if (!/^[a-z0-9_]+$/i.test(name)) {
    throw new Error(`Refusing to use unsafe database identifier "${name}".`);
  }
}

function targetUrl() {
  return deriveConnectionString(baseTarget.connectionString, createdDatabase);
}

function stubProvider() {
  return {
    async embedManyWithUsage(texts) {
      return {
        embeddings: texts.map(() => vector()),
        usage: { totalTokens: texts.length },
        usageAvailable: true
      };
    }
  };
}

before(async () => {
  if (configError) {
    throw configError;
  }

  if (!baseTarget) {
    skipReason = `Set ${INTEGRATION_DB_ENV} to a disposable local database to run these tests.`;
    return;
  }

  createdDatabase = `atlas_write_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  assertSafeIdentifier(createdDatabase);

  adminClient = new Client({ connectionString: deriveConnectionString(baseTarget.connectionString, 'postgres') });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${createdDatabase}"`);

  pool = createIntegrationPool({
    connectionString: deriveConnectionString(baseTarget.connectionString, createdDatabase),
    database: createdDatabase,
    host: baseTarget.host,
    port: baseTarget.port
  });

  await verifyIntegrationTarget(pool, { database: createdDatabase });
  await applySchema(pool);
});

after(async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }

  if (adminClient && createdDatabase) {
    try {
      await adminClient.query(`DROP DATABASE IF EXISTS "${createdDatabase}" WITH (FORCE)`);
    } finally {
      await adminClient.end();
    }
  } else if (adminClient) {
    await adminClient.end();
  }
});

async function runWriteMain({ argv, createProvider }) {
  const out = [];
  const err = [];

  const res = await main({
    argv: [
      '--write',
      '--json',
      '--database-url', deriveConnectionString(baseTarget.connectionString, createdDatabase),
      '--allow-database', createdDatabase,
      ...argv
    ],
    env: {},
    deps: {
      createProvider,
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      logger: { error() {} },
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  return { res, report: out.length > 0 ? JSON.parse(out.join('')) : null, err };
}

async function embeddedChunkIds(documentId, spaceId) {
  const { rows } = await pool.query(
    `SELECT ce.chunk_id
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
      WHERE c.document_id = $1 AND ce.space_id = $2
      ORDER BY ce.chunk_id`,
    [documentId, spaceId]
  );

  return rows.map((row) => row.chunk_id);
}

async function progressStatus(documentId) {
  const { rows } = await pool.query(
    'SELECT status FROM embedding_backfill_progress WHERE document_id = $1 AND space_id = $2',
    [documentId, SPACE_ID]
  );

  return rows[0]?.status ?? null;
}

async function documentStatus(documentId) {
  const { rows } = await pool.query('SELECT status FROM documents WHERE id = $1', [documentId]);
  return rows[0]?.status ?? null;
}

test('write mode backfills exactly the ready target document and leaves everything else alone', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  // Ordered by id ascending: T, C, X are the first three ready documents.
  const docT = '11111111-1111-4111-8111-111111111111';
  const docC = '22222222-2222-4222-8222-222222222222';
  const docX = '33333333-3333-4333-8333-333333333333';
  const docG = '44444444-4444-4444-8444-444444444444';

  const t1 = 'aaaaaaaa-0000-4000-8000-000000000001';
  const t2 = 'aaaaaaaa-0000-4000-8000-000000000002';
  const c1 = 'bbbbbbbb-0000-4000-8000-000000000001';
  const g1 = 'cccccccc-0000-4000-8000-000000000001';

  // T: ready, two chunks; t1 already has a BGE embedding but no Voyage row.
  await insertDocument(pool, { id: docT });
  await insertChunk(pool, { id: t1, documentId: docT, chunkIndex: 0 });
  await insertChunk(pool, { id: t2, documentId: docT, chunkIndex: 1 });
  await insertChunkEmbedding(pool, { chunkId: t1, documentId: docT, spaceId: BGE_SPACE });

  // C: ready and already complete in the Voyage space.
  await insertDocument(pool, { id: docC });
  await insertChunk(pool, { id: c1, documentId: docC, chunkIndex: 0 });
  await insertChunkEmbedding(pool, { chunkId: c1, documentId: docC, spaceId: SPACE_ID });

  // X: ready with zero chunks (trivially complete, must be flagged).
  await insertDocument(pool, { id: docX });

  // G: not ready; must never be touched.
  await insertDocument(pool, { id: docG, status: 'embedding' });
  await insertChunk(pool, { id: g1, documentId: docG, chunkIndex: 0 });

  const statusesBefore = (await pool.query('SELECT id, status FROM documents ORDER BY id')).rows;
  const bgeBefore = await embeddedChunkIds(docT, BGE_SPACE);

  const { res, report, err } = await runWriteMain({
    argv: ['--limit', '3'],
    createProvider: () => ({
      async embedManyWithUsage(texts) {
        return { embeddings: texts.map(() => vector()), usage: { totalTokens: texts.length }, usageAvailable: true };
      }
    })
  });

  assert.equal(res.exitCode, 0);
  assert.deepEqual(err, []);
  assert.equal(report.mode, 'write');
  assert.equal(report.readOnly, false);
  assert.equal(report.operatorPolicy, 'operator');
  assert.equal(report.allowlistedTarget, true);
  assert.equal(report.attemptedDocuments, 3);
  assert.equal(report.completedDocuments, 3);
  assert.equal(report.failedDocuments, 0);
  assert.equal(report.providerDispatches, 1, 'only T needed a provider dispatch');
  assert.equal(report.allSuccessful, true);
  assert.equal(report.warnings.length, 1, 'the zero-chunk document is flagged, not hidden');
  assert.equal(report.warnings[0].documentId, docX);

  // T is fully embedded in the Voyage space.
  assert.deepEqual(await embeddedChunkIds(docT, SPACE_ID), [t1, t2]);
  assert.equal(await embeddedChunkIds(docC, SPACE_ID).then((ids) => ids.length), 1);
  assert.deepEqual(await embeddedChunkIds(docX, SPACE_ID), []);
  assert.deepEqual(await embeddedChunkIds(docG, SPACE_ID), []);

  // The pre-existing BGE embedding is untouched by the Voyage write.
  assert.deepEqual(await embeddedChunkIds(docT, BGE_SPACE), bgeBefore);
  assert.equal((await embeddedChunkIds(docT, BGE_SPACE)).length, 1);

  // Progress bookkeeping.
  assert.equal(await progressStatus(docT), 'completed');
  assert.equal(await progressStatus(docC), 'completed');
  assert.equal(await progressStatus(docX), 'completed');
  assert.equal(await progressStatus(docG), null, 'a non-ready document was never processed');

  // Document statuses are never changed by the backfill.
  const statusesAfter = (await pool.query('SELECT id, status FROM documents ORDER BY id')).rows;
  assert.deepEqual(statusesAfter, statusesBefore);

  // No orphaned target-space rows.
  const { rows: orphanRows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM chunk_embeddings ce
       LEFT JOIN chunks c ON c.id = ce.chunk_id
      WHERE ce.space_id = $1 AND c.id IS NULL`,
    [SPACE_ID]
  );
  assert.equal(orphanRows[0].n, 0);
});

test('a provider failure stops the run, records failure, and is never retried', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const docF = '00000000-0000-4000-8000-000000000000';
  const f1 = 'dddddddd-0000-4000-8000-000000000001';

  await insertDocument(pool, { id: docF });
  await insertChunk(pool, { id: f1, documentId: docF, chunkIndex: 0 });

  let dispatches = 0;
  const { res, report, err } = await runWriteMain({
    argv: ['--limit', '1'],
    createProvider: () => ({
      async embedManyWithUsage() {
        dispatches += 1;
        throw new ProviderError('embedding provider unavailable', { provider: 'test', statusCode: 500 });
      }
    })
  });

  assert.equal(res.exitCode, 2, 'a failed attempt after work started exits 2');
  assert.equal(dispatches, 1, 'the document is attempted exactly once and never retried');
  assert.equal(report.attemptedDocuments, 1);
  assert.equal(report.failedDocuments, 1);
  assert.equal(report.completedDocuments, 0);
  assert.equal(report.stoppedEarly, true);
  assert.equal(report.stopReason, 'provider_transient');
  assert.equal(report.allSuccessful, false);

  const embedded = await embeddedChunkIds(docF, SPACE_ID);
  assert.deepEqual(embedded, [], 'no partial embeddings are left behind');
  assert.equal(await progressStatus(docF), 'failed');
  assert.equal(await documentStatus(docF), 'ready', 'the document status is untouched');
});
