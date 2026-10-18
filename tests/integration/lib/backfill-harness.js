import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { Pool } from 'pg';
import { toSql } from 'pgvector';

export const INTEGRATION_DB_ENV = 'ATLAS_BACKFILL_INTEGRATION_DATABASE_URL';

// Same family of names the established dev-tool guard accepts, but scoped to
// disposable/test targets only. A staging/production name is explicitly refused.
const SAFE_DB_PATTERN = /(disposable|test|scratch|sandbox)/i;
const FORBIDDEN_DB_PATTERN = /(staging|stage|_stg|prod|production|live)/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../database/schema.sql'
);

/**
 * Resolve and validate the disposable integration database target.
 *
 * Returns `null` when no target is configured (tests then skip). Throws when a
 * target is configured but is unsafe. The resolver never falls back to
 * `DATABASE_URL` and refuses any non-local host, staging/production name, or a
 * URL identical to `DATABASE_URL`.
 */
export function resolveIntegrationTarget(env = process.env) {
  const raw = env[INTEGRATION_DB_ENV];

  if (!raw) {
    return null;
  }

  if (env.DATABASE_URL && raw === env.DATABASE_URL) {
    throw new Error(
      `Refusing to run: ${INTEGRATION_DB_ENV} is identical to DATABASE_URL (production).`
    );
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Refusing to run: ${INTEGRATION_DB_ENV} is not a valid URL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const host = parsed.hostname;

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run: host "${host}" is not local. Integration tests only touch a disposable local database.`
    );
  }

  if (FORBIDDEN_DB_PATTERN.test(database)) {
    throw new Error(
      `Refusing to run: database name "${database}" looks like staging/production.`
    );
  }

  if (!SAFE_DB_PATTERN.test(database)) {
    throw new Error(
      `Refusing to run: database name "${database}" does not look disposable (expected it to match ${SAFE_DB_PATTERN}).`
    );
  }

  return {
    connectionString: raw,
    database,
    host,
    port: parsed.port || '5432'
  };
}

/** Connect and re-verify the identity of the database we actually reached. */
export async function verifyIntegrationTarget(pool, target) {
  const { rows } = await pool.query(
    'SELECT current_database() AS database, inet_server_addr()::text AS server_addr, version() AS version'
  );
  const row = rows[0];

  if (row.database !== target.database) {
    throw new Error(
      `Refusing to run: connected to database "${row.database}" but target was "${target.database}".`
    );
  }

  if (FORBIDDEN_DB_PATTERN.test(row.database)) {
    throw new Error(`Refusing to run: connected database "${row.database}" looks like staging/production.`);
  }

  return row;
}

export function createIntegrationPool(target) {
  return new Pool({ connectionString: target.connectionString, max: 8 });
}

export async function applySchema(pool) {
  const sql = await readFile(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
}

/** Drop and recreate the `public` schema so each run starts clean. */
export async function resetSchema(pool) {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

export function vector(dimensions = 1024) {
  return Array.from({ length: dimensions }, (_, index) => Number((index % 7) + 1) / 100);
}

export async function insertDocument(queryable, { id, status = 'ready', fileName = 'doc.txt' } = {}) {
  await queryable.query(
    `
      INSERT INTO documents (id, file_name, file_type, file_size_bytes, status, extracted_text)
      VALUES ($1, $2, 'text/plain', 10, $3, 'seed')
    `,
    [id, fileName, status]
  );
}

export async function insertChunk(queryable, { id, documentId, chunkIndex, content = `chunk-${chunkIndex}` }) {
  await queryable.query(
    `
      INSERT INTO chunks (id, document_id, chunk_index, content, character_count)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [id, documentId, chunkIndex, content, content.length]
  );
}

export async function insertChunkEmbedding(queryable, { chunkId, documentId, spaceId }) {
  await queryable.query(
    `
      INSERT INTO chunk_embeddings (chunk_id, document_id, space_id, embedding, l2_norm)
      VALUES ($1, $2, $3, $4::vector, 1.0)
    `,
    [chunkId, documentId, spaceId, toSql(vector())]
  );
}

/**
 * Assert the core invariant from the database's point of view:
 * a document must never be `completed` while any current chunk lacks a
 * `chunk_embeddings` row for the target space.
 */
export async function readInvariantState(queryable, documentId, spaceId) {
  const { rows } = await queryable.query(
    `
      SELECT
        (SELECT count(*)::int FROM chunks WHERE document_id = $1) AS chunk_count,
        (
          SELECT count(*)::int
          FROM chunks c
          JOIN chunk_embeddings ce ON ce.chunk_id = c.id AND ce.space_id = $2
          WHERE c.document_id = $1
        ) AS embedded_count,
        (
          SELECT status FROM embedding_backfill_progress
          WHERE document_id = $1 AND space_id = $2
        ) AS progress_status
    `,
    [documentId, spaceId]
  );

  const state = rows[0];
  const chunkCount = Number(state.chunk_count);
  const embeddedCount = Number(state.embedded_count);
  const missingCount = chunkCount - embeddedCount;

  return {
    chunkCount,
    embeddedCount,
    missingCount,
    progressStatus: state.progress_status ?? null,
    invariantViolated: state.progress_status === 'completed' && missingCount > 0
  };
}

export async function assertInvariant(pool, documentId, spaceId) {
  const state = await readInvariantState(pool, documentId, spaceId);

  if (state.invariantViolated) {
    throw new Error(
      `Invariant violated for document ${documentId}: progress is "completed" while `
      + `${state.missingCount} of ${state.chunkCount} chunks lack a ${spaceId} embedding.`
    );
  }

  return state;
}

/** Deterministic 64-bit advisory-lock key derived from a document id. */
export function advisoryLockSql() {
  return `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`;
}

export async function withClient(pool, fn) {
  const client = await pool.connect();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Acquire a pooled connection with bounded lock/statement timeouts so a bug in
 * a test's interleaving fails fast instead of hanging the suite.
 */
export async function acquireClient(pool) {
  const client = await pool.connect();
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '15s'");
  return client;
}

// Advisory-lock key shared by every integration file that resets the same
// disposable schema. The lock is held for the lifetime of the file so two files
// running concurrently cannot drop/recreate the schema out from under each
// other's tests.
export const INTEGRATION_SCHEMA_LOCK_KEY = 918273645;

/**
 * Acquire a session-level advisory lock that serializes schema setup across
 * concurrent integration files sharing one disposable database.
 *
 * The returned client must be held until the file's tests finish and passed to
 * `releaseSchemaLock`.
 */
export async function acquireSchemaLock(pool) {
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock($1)', [INTEGRATION_SCHEMA_LOCK_KEY]);
  return client;
}

export async function releaseSchemaLock(client) {
  if (!client) {
    return;
  }

  try {
    await client.query('SELECT pg_advisory_unlock($1)', [INTEGRATION_SCHEMA_LOCK_KEY]);
  } catch {
    // The connection is already gone; the lock dies with the session anyway.
  }

  client.release();
}

/**
 * Return a client to the pool in a clean state. A connection that is mid
 * transaction (or aborted) is rolled back first, which releases any
 * transaction-scoped advisory locks it still holds.
 */
export async function releaseClient(client) {
  if (!client) {
    return;
  }

  try {
    await client.query('ROLLBACK');
  } catch {
    // No transaction in progress, or the connection is already gone.
  }

  client.release();
}
