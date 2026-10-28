import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';

import { Client } from 'pg';

import {
  INTEGRATION_DB_ENV,
  createIntegrationPool,
  resetSchema,
  resolveIntegrationTarget,
  verifyIntegrationTarget
} from './lib/backfill-harness.js';

const MIGRATION_PATH = new URL(
  '../../database/migrations/20261027_add_chunk_embedding_space.sql',
  import.meta.url
);
const MIGRATION_INDEX_PATH = new URL(
  '../../database/migrations/20261028_add_chunk_embedding_space_index_concurrently.sql',
  import.meta.url
);
const CHUNK_ID = 'cccccccc-1111-4111-8111-111111111111';
const LEGACY_VECTOR_VALUES = Array.from({ length: 384 }, () => 0);
LEGACY_VECTOR_VALUES[0] = 0.1;
const LEGACY_VECTOR = JSON.stringify(LEGACY_VECTOR_VALUES);

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

async function readMigration() {
  return readFile(MIGRATION_PATH, 'utf8');
}

async function readMigrationIndex() {
  return readFile(MIGRATION_INDEX_PATH, 'utf8');
}

async function createPreMigrationSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE chunks (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL,
      chunk_index integer NOT NULL,
      content text NOT NULL,
      character_count integer NOT NULL,
      embedding vector(384)
    )
  `);
  await pool.query(
    `INSERT INTO chunks (id, document_id, chunk_index, content, character_count, embedding)
     VALUES ($1, $2, 0, 'legacy', 6, $3::vector)`,
    [CHUNK_ID, randomUUID(), LEGACY_VECTOR]
  );
}

async function readChunkState() {
  const hasSpaceColumn = Boolean(await readColumn());
  const spaceSelection = hasSpaceColumn ? ', embedding_space_id' : '';
  const { rows } = await pool.query(
    `SELECT md5(embedding::text) AS embedding_fingerprint,
            vector_dims(embedding) AS dimensions${spaceSelection}
     FROM chunks WHERE id = $1`,
    [CHUNK_ID]
  );
  return { ...rows[0], embedding_space_id: hasSpaceColumn ? rows[0].embedding_space_id : undefined };
}

async function readColumn(queryable = pool) {
  const { rows } = await queryable.query(
    `SELECT data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'chunks'
       AND column_name = 'embedding_space_id'`
  );
  return rows[0] ?? null;
}

async function readIndex() {
  const { rows } = await pool.query(
    `SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'chunks_embedding_space_idx'`
  );
  return rows[0] ?? null;
}

async function readComment() {
  const { rows } = await pool.query(
    `SELECT col_description('chunks'::regclass, a.attnum) AS comment
     FROM pg_attribute a
     WHERE a.attrelid = 'chunks'::regclass AND a.attname = 'embedding_space_id'`
  );
  return rows[0]?.comment ?? null;
}

before(async () => {
  if (configError) {
    throw configError;
  }

  if (!baseTarget) {
    skipReason = `Set ${INTEGRATION_DB_ENV} to a disposable local database to run these tests.`;
    return;
  }

  createdDatabase = `atlas_migration_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  adminClient = new Client({
    connectionString: deriveConnectionString(baseTarget.connectionString, 'postgres')
  });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${createdDatabase}"`);

  pool = createIntegrationPool({
    connectionString: deriveConnectionString(baseTarget.connectionString, createdDatabase),
    database: createdDatabase,
    host: baseTarget.host,
    port: baseTarget.port
  });

  await verifyIntegrationTarget(pool, { database: createdDatabase });
});

beforeEach(async () => {
  if (skipReason) {
    return;
  }

  await resetSchema(pool);
  await createPreMigrationSchema();
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

test('integration target guard refuses DATABASE_URL and production-like targets', () => {
  assert.throws(
    () => resolveIntegrationTarget({
      [INTEGRATION_DB_ENV]: 'postgresql://localhost:5432/atlas_test',
      DATABASE_URL: 'postgresql://localhost:5432/atlas_test'
    }),
    /identical to DATABASE_URL/
  );
  assert.throws(
    () => resolveIntegrationTarget({
      [INTEGRATION_DB_ENV]: 'postgresql://db.example.com/atlas_test'
    }),
    /not local/
  );
  assert.throws(
    () => resolveIntegrationTarget({
      [INTEGRATION_DB_ENV]: 'postgresql://localhost:5432/atlas_production'
    }),
    /staging\/production/
  );
  assert.throws(
    () => resolveIntegrationTarget({
      [INTEGRATION_DB_ENV]: 'postgresql://localhost:5432/atlas'
    }),
    /does not look disposable/
  );
});

test('additive migration preserves vectors and legacy NULL provenance', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const beforeState = await readChunkState();
  assert.equal(beforeState.embedding_space_id, undefined);
  assert.equal(Number(beforeState.dimensions), 384);

  await pool.query(await readMigration());
  await pool.query(await readMigrationIndex());

  const column = await readColumn();
  assert.deepEqual(column, {
    data_type: 'text',
    is_nullable: 'YES',
    column_default: null
  });

  const index = await readIndex();
  assert.ok(index, 'expected the provenance index');
  assert.equal(index.indisvalid, true);
  assert.equal(index.indisready, true);
  assert.match(index.definition, /btree \(embedding_space_id\)/);

  const comment = await readComment();
  assert.match(comment, /NULL means legacy\/unknown provenance/);

  const afterState = await readChunkState();
  assert.equal(afterState.embedding_fingerprint, beforeState.embedding_fingerprint);
  assert.equal(Number(afterState.dimensions), 384);
  assert.equal(afterState.embedding_space_id, null);
});

test('migration is idempotent and commits cleanly in a transaction', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const beforeState = await readChunkState();
  const migration = await readMigration();
  const migrationIndex = await readMigrationIndex();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await client.query(migration);
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  await pool.query(migrationIndex);
  await pool.query(migrationIndex);

  const state = await readChunkState();
  assert.equal(state.embedding_fingerprint, beforeState.embedding_fingerprint);
  assert.equal(state.embedding_space_id, null);
  assert.equal((await readColumn()).data_type, 'text');
  assert.equal((await readIndex()).indisvalid, true);
});

test('a rolled-back migration leaves the pre-migration schema intact', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const beforeState = await readChunkState();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(await readMigration());
    assert.ok(await readColumn(client), 'column exists inside the transaction');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  assert.equal(await readColumn(), null);
  assert.equal(await readIndex(), null);

  const { rows } = await pool.query(
    'SELECT md5(embedding::text) AS fingerprint, vector_dims(embedding) AS dimensions FROM chunks WHERE id = $1',
    [CHUNK_ID]
  );
  assert.equal(rows[0].fingerprint, beforeState.embedding_fingerprint);
  assert.equal(Number(rows[0].dimensions), 384);
});
