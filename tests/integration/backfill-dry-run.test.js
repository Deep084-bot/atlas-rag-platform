import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { Client } from 'pg';

import { main } from '../../scripts/dev/embedding-backfill.mjs';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import {
  INTEGRATION_DB_ENV,
  applySchema,
  createIntegrationPool,
  insertChunk,
  insertChunkEmbedding,
  insertDocument,
  resolveIntegrationTarget,
  verifyIntegrationTarget
} from './lib/backfill-harness.js';

/**
 * End-to-end test for the read-only dry-run inspector against a real
 * disposable local PostgreSQL database.
 *
 * This file creates its own dedicated disposable database (derived from the
 * configured base target) so it never shares schema state with the other
 * integration file when `node --test` runs files in parallel. It is skipped
 * unless `ATLAS_BACKFILL_INTEGRATION_DATABASE_URL` points at a disposable local
 * database, and the base target is validated by the shared harness guard
 * before anything is created.
 */

const SPACE_ID = VOYAGE_SPACE.id;

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

before(async () => {
  if (configError) {
    throw configError;
  }

  if (!baseTarget) {
    skipReason = `Set ${INTEGRATION_DB_ENV} to a disposable local database to run these tests.`;
    return;
  }

  createdDatabase = `atlas_dryrun_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
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

async function countRows(table) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
  return rows[0].c;
}

test('dry-run inspects real documents with identity-based completeness and no writes', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  // 1) complete doc: 2 chunks, both embedded.
  const docComplete = randomUUID();
  await insertDocument(pool, { id: docComplete });
  const c1 = randomUUID();
  const c2 = randomUUID();
  await insertChunk(pool, { id: c1, documentId: docComplete, chunkIndex: 1 });
  await insertChunk(pool, { id: c2, documentId: docComplete, chunkIndex: 2 });
  await insertChunkEmbedding(pool, { chunkId: c1, documentId: docComplete, spaceId: SPACE_ID });
  await insertChunkEmbedding(pool, { chunkId: c2, documentId: docComplete, spaceId: SPACE_ID });

  // 2) incomplete doc: 3 chunks, 1 embedded.
  const docIncomplete = randomUUID();
  await insertDocument(pool, { id: docIncomplete });
  const d1 = randomUUID();
  const d2 = randomUUID();
  const d3 = randomUUID();
  await insertChunk(pool, { id: d1, documentId: docIncomplete, chunkIndex: 1 });
  await insertChunk(pool, { id: d2, documentId: docIncomplete, chunkIndex: 2 });
  await insertChunk(pool, { id: d3, documentId: docIncomplete, chunkIndex: 3 });
  await insertChunkEmbedding(pool, { chunkId: d1, documentId: docIncomplete, spaceId: SPACE_ID });

  // 3) empty ready doc.
  const docEmpty = randomUUID();
  await insertDocument(pool, { id: docEmpty });

  // 4) non-ready doc (uploaded) with a chunk: must be excluded from the scan.
  const docNonReady = randomUUID();
  await insertDocument(pool, { id: docNonReady, status: 'uploaded' });
  await insertChunk(pool, { id: randomUUID(), documentId: docNonReady, chunkIndex: 1 });

  const progressBefore = await countRows('embedding_backfill_progress');
  const embeddingsBefore = await countRows('chunk_embeddings');
  const chunksBefore = await countRows('chunks');
  const statusesBefore = (await pool.query('SELECT id, status FROM documents ORDER BY id')).rows;

  const out = [];
  const err = [];
  const res = await main({
    argv: ['--dry-run', '--json', '--database-url', deriveConnectionString(baseTarget.connectionString, createdDatabase)],
    env: {},
    deps: {
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      logger: { error() {} },
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(err.length, 0);

  const report = JSON.parse(out.join(''));
  assert.equal(report.eligibleDocuments, 3, 'only ready documents are eligible');
  assert.equal(report.completeDocuments, 2, 'the fully embedded and the empty document are complete');
  assert.equal(report.incompleteDocuments, 1);
  assert.equal(report.uninspectableDocuments, 0);
  assert.equal(report.documentsNeedingWork, 1);
  assert.equal(report.totalChunks, 5);
  assert.equal(report.embeddedChunks, 3);
  assert.equal(report.missingChunks, 2);
  assert.equal(report.scanComplete, true);
  assert.equal(report.truncated, false);
  assert.equal(report.readOnly, true);
  assert.equal(report.pointInTime, true);
  assert.match(report.note, /Point-in-time/);

  // No writes of any kind.
  assert.equal(await countRows('embedding_backfill_progress'), progressBefore);
  assert.equal(await countRows('chunk_embeddings'), embeddingsBefore);
  assert.equal(await countRows('chunks'), chunksBefore);
  const statusesAfter = (await pool.query('SELECT id, status FROM documents ORDER BY id')).rows;
  assert.deepEqual(statusesAfter, statusesBefore, 'document statuses are unchanged');
});

test('dry-run with --limit truncates and exits 2 without writing', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const progressBefore = await countRows('embedding_backfill_progress');
  const out = [];
  const err = [];

  const res = await main({
    argv: ['--dry-run', '--json', '--limit', '1', '--database-url', deriveConnectionString(baseTarget.connectionString, createdDatabase)],
    env: {},
    deps: {
      write: (text) => out.push(text),
      writeError: (text) => err.push(text),
      logger: { error() {} },
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 2);
  const report = JSON.parse(out.join(''));
  assert.equal(report.truncated, true);
  assert.equal(report.scanComplete, false);
  assert.equal(report.eligibleDocuments, 1);
  assert.equal(await countRows('embedding_backfill_progress'), progressBefore);
});
