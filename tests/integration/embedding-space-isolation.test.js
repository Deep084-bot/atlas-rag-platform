import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';

import { Client } from 'pg';
import { toSql } from 'pgvector';

import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import {
  HOSTED_BGE_SPACE,
  LOCAL_BGE_SPACE
} from '../../server/embeddings/embeddingSpaces.js';
import { createSearchService } from '../../server/search/searchService.js';
import { SearchRepository } from '../../server/search/searchRepository.js';
import {
  INTEGRATION_DB_ENV,
  applySchema,
  createIntegrationPool,
  insertChunk,
  insertDocument,
  resetSchema,
  resolveIntegrationTarget,
  vector,
  verifyIntegrationTarget
} from './lib/backfill-harness.js';

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

before(async () => {
  if (configError) {
    throw configError;
  }

  if (!baseTarget) {
    skipReason = `Set ${INTEGRATION_DB_ENV} to a disposable local database to run these tests.`;
    return;
  }

  createdDatabase = `atlas_space_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  if (!/^[a-z0-9_]+$/i.test(createdDatabase)) {
    throw new Error('Unsafe generated database identifier.');
  }

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
  await applySchema(pool);
});

beforeEach(async () => {
  if (skipReason) {
    return;
  }

  await resetSchema(pool);
  await applySchema(pool);
  await seed();
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

async function tagEmbedding(chunkId, spaceId, embedding = vector(384)) {
  await pool.query(
    'UPDATE chunks SET embedding = $2::vector, embedding_space_id = $3 WHERE id = $1',
    [chunkId, toSql(embedding), spaceId]
  );
}

async function seed() {
  const documentId = 'aaaaaaaa-1111-4111-8111-111111111111';
  await insertDocument(pool, { id: documentId, fileName: 'space.txt' });
  await pool.query('UPDATE documents SET user_id = $2 WHERE id = $1', [documentId, 'user-1']);

  const hostedChunk = 'bbbbbbbb-1111-4111-8111-111111111111';
  const legacyChunk = 'bbbbbbbb-2222-4222-8222-222222222222';
  const localChunk = 'bbbbbbbb-3333-4333-8333-333333333333';
  const blankChunk = 'bbbbbbbb-4444-4444-8444-444444444444';

  await insertChunk(pool, { id: hostedChunk, documentId, chunkIndex: 0, content: 'hosted' });
  await insertChunk(pool, { id: legacyChunk, documentId, chunkIndex: 1, content: 'legacy' });
  await insertChunk(pool, { id: localChunk, documentId, chunkIndex: 2, content: 'local' });
  await insertChunk(pool, { id: blankChunk, documentId, chunkIndex: 3, content: 'blank' });

  await tagEmbedding(hostedChunk, HOSTED_BGE_SPACE.id);
  await tagEmbedding(legacyChunk, null);
  await tagEmbedding(localChunk, LOCAL_BGE_SPACE.id);

  return { documentId, hostedChunk, legacyChunk, localChunk, blankChunk };
}

test('summaries distinguish hosted, local, and legacy-unknown vectors', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const repository = new SearchRepository(pool);

  const hosted = await repository.summarizeIncompatibleEmbeddings({
    spaceId: HOSTED_BGE_SPACE.id,
    includeLegacyUnknown: true
  });
  assert.equal(hosted.total, 1);
  assert.deepEqual(hosted.spaces, [{ spaceId: LOCAL_BGE_SPACE.id, chunkCount: 1 }]);

  const local = await repository.summarizeIncompatibleEmbeddings({
    spaceId: LOCAL_BGE_SPACE.id,
    includeLegacyUnknown: false
  });
  assert.equal(local.total, 2);
  assert.deepEqual(local.spaces, [
    { spaceId: HOSTED_BGE_SPACE.id, chunkCount: 1 },
    { spaceId: 'legacy-unknown', chunkCount: 1 }
  ]);

  const localIncludingLegacy = await repository.summarizeIncompatibleEmbeddings({
    spaceId: LOCAL_BGE_SPACE.id,
    includeLegacyUnknown: true
  });
  assert.equal(localIncludingLegacy.total, 1);
  assert.deepEqual(localIncludingLegacy.spaces, [
    { spaceId: HOSTED_BGE_SPACE.id, chunkCount: 1 }
  ]);
});

test('retrieval filters out vectors from other spaces and legacy rows for local search', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const repository = new SearchRepository(pool);
  const embedding = vector(384);

  const hosted = await repository.searchChunksByEmbeddingForUser({
    userId: 'user-1',
    embedding,
    limit: 10,
    conversationId: null,
    spaceId: HOSTED_BGE_SPACE.id,
    includeLegacyUnknown: true
  });
  assert.deepEqual(hosted.map((row) => row.chunkText).sort(), ['hosted', 'legacy']);

  const local = await repository.searchChunksByEmbeddingForUser({
    userId: 'user-1',
    embedding,
    limit: 10,
    conversationId: null,
    spaceId: LOCAL_BGE_SPACE.id,
    includeLegacyUnknown: false
  });
  assert.deepEqual(local.map((row) => row.chunkText), ['local']);
});

test('search blocks a local query while hosted vectors remain', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const service = createSearchService({
    embeddingProvider: {
      embed: async () => {
        throw new Error('provider should not be called after a space mismatch');
      }
    },
    searchRepository: new SearchRepository(pool),
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    () => service.search('hello', { userId: 'user-1' }),
    (error) => error.name === 'EmbeddingSpaceError' && /Search is blocked/.test(error.message)
  );
});

test('embedding writes tag the row with the active space', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const chunkId = (await pool.query(
    `SELECT id FROM chunks WHERE content = 'blank' LIMIT 1`
  )).rows[0].id;
  const repository = new EmbeddingRepository(pool);

  const updated = await repository.updateChunkEmbedding(chunkId, vector(384), {
    spaceId: LOCAL_BGE_SPACE.id
  });

  assert.equal(updated.embedding_space_id, LOCAL_BGE_SPACE.id);
  const count = await repository.countEmbeddedChunks(
    'aaaaaaaa-1111-4111-8111-111111111111',
    { spaceId: LOCAL_BGE_SPACE.id, includeLegacyUnknown: false }
  );
  assert.equal(count, 2);
});
