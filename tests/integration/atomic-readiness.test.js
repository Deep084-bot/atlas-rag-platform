import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';
import { ChunkEmbeddingRepository } from '../../server/embeddings/chunkEmbeddingRepository.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { EmbeddingBackfillProgressRepository } from '../../server/embeddings/embeddingBackfillProgressRepository.js';
import { createEmbeddingService } from '../../server/embeddings/embeddingService.js';
import { createEmbeddingBackfillRunner, withTransaction } from '../../server/embeddings/embeddingBackfillRunner.js';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';
import {
  INTEGRATION_DB_ENV,
  acquireClient,
  acquireSchemaLock,
  applySchema,
  createIntegrationPool,
  insertChunk,
  insertChunkEmbedding,
  insertDocument,
  releaseClient,
  releaseSchemaLock,
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
let schemaLockClient = null;
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
  // Serialize schema (re)creation with any other integration file sharing this
  // disposable database, then hold the lock until this file's tests finish.
  schemaLockClient = await acquireSchemaLock(pool);
  await resetSchema(pool);
  await applySchema(pool);
});

after(async () => {
  await releaseSchemaLock(schemaLockClient);
  schemaLockClient = null;

  if (pool) {
    await pool.end();
    pool = null;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubProvider() {
  return {
    async embedMany(texts) {
      return texts.map(() => Array.from({ length: DIMENSIONS }, () => 0.01));
    }
  };
}

function createReadyStack() {
  const documentsRepository = new DocumentsRepository(pool);
  const embeddingRepository = new EmbeddingRepository(pool);
  const chunkEmbeddingRepository = new ChunkEmbeddingRepository(pool);
  const embeddingBackfillRunner = createEmbeddingBackfillRunner({
    pool,
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository,
    embeddingBackfillProgressRepository: new EmbeddingBackfillProgressRepository(pool),
    embeddingProvider: stubProvider(),
    space: VOYAGE_SPACE,
    logger: { error() {}, log() {} }
  });

  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository,
    embeddingBackfillRunner,
    embeddingProvider: stubProvider(),
    space: VOYAGE_SPACE
  });

  // The orchestrator embeds via a stub (the embedding itself is not under test),
  // but verifies completeness through the REAL identity-based service, on the
  // transaction client it opens with the real `withTransaction` helper.
  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService: {
      async embedDocument(documentId) {
        return { documentId, status: 'completed' };
      },
      getEmbeddingStatus: (documentId, options) => service.getEmbeddingStatus(documentId, options)
    },
    ocrService: null,
    runInTransaction: (fn) => withTransaction(pool, fn)
  });

  return { orchestrator, documentsRepository, service };
}

async function seedReadyDocument({ chunks = 2, embedded = true } = {}) {
  const documentId = randomUUID();

  await insertDocument(pool, { id: documentId, status: 'ready' });

  for (let index = 1; index <= chunks; index += 1) {
    const chunkId = randomUUID();
    await insertChunk(pool, { id: chunkId, documentId, chunkIndex: index });

    if (embedded) {
      await insertChunkEmbedding(pool, { chunkId, documentId, spaceId: SPACE_ID });
    }
  }

  if (embedded) {
    await new EmbeddingBackfillProgressRepository(pool).markCompleted({
      spaceId: SPACE_ID,
      documentId,
      expectedChunkCount: chunks,
      completedChunkCount: chunks
    });
  }

  return { documentId };
}

async function readReadinessState(queryable, documentId) {
  const { rows } = await queryable.query(
    `
      SELECT
        (SELECT status FROM documents WHERE id = $1) AS status,
        (SELECT count(*)::int FROM chunks WHERE document_id = $1) AS chunk_count,
        (
          SELECT count(*)::int
          FROM chunk_embeddings
          WHERE document_id = $1 AND space_id = $2
        ) AS embedded_count
    `,
    [documentId, SPACE_ID]
  );

  return {
    status: rows[0].status,
    chunkCount: rows[0].chunk_count,
    embeddedCount: rows[0].embedded_count
  };
}

// ---------------------------------------------------------------------------
// Atomicity: verification and markReady happen on one connection under the
// document row lock, so a replacement can never slip between them.
// ---------------------------------------------------------------------------

test('the readiness lock blocks a concurrent replacement until it commits', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedReadyDocument();
  const { documentsRepository, service } = createReadyStack();
  const chunkRepository = new ChunkRepository(pool);

  const clientA = await acquireClient(pool);
  let replacement = null;
  let settled = false;

  try {
    await clientA.query('BEGIN');

    // Simulate exactly what the orchestrator does: lock, verify against the
    // active space on the same client, then publish readiness — all before the
    // replacement may proceed.
    const lock = await documentsRepository.lockForUpdate(documentId, { client: clientA });
    assert.ok(lock, 'readiness acquires the document row lock');

    const verification = await service.getEmbeddingStatus(documentId, { client: clientA });
    assert.equal(verification.complete, true);

    await documentsRepository.markReady(documentId, { progress: 100 }, { client: clientA });

    replacement = chunkRepository.replaceDocumentChunks(documentId, [
      { chunkIndex: 1, content: 'replacement one', characterCount: 15 }
    ]).then((value) => {
      settled = true;
      return value;
    });

    await sleep(150);
    assert.equal(settled, false, 'the replacement blocks while readiness holds the document lock');

    await clientA.query('COMMIT');
    await replacement;
  } finally {
    await releaseClient(clientA);
    if (replacement) {
      await replacement.catch(() => {});
    }
  }

  // The replacement committed after readiness and must have demoted the row:
  // there is no committed `ready` document with unembedded chunks.
  const state = await readReadinessState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 1);
  assert.equal(state.embeddedCount, 0);
  assert.notEqual(state.status, 'ready', 'the replacement demoted the document out of ready');
});

test('a replacement holding the lock forces readiness to fail closed', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const { documentId } = await seedReadyDocument();
  const { orchestrator } = createReadyStack();

  const clientA = await acquireClient(pool);
  let settled = false;

  try {
    await clientA.query('BEGIN');
    await new DocumentsRepository(pool).lockForUpdate(documentId, { client: clientA });

    // Perform the replacement inline on clientA, mirroring ChunkRepository, and
    // hold the transaction open so the readiness attempt must wait.
    await clientA.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
    await clientA.query('DELETE FROM embedding_backfill_progress WHERE document_id = $1', [documentId]);

    for (let index = 1; index <= 2; index += 1) {
      const chunkId = randomUUID();
      await insertChunk(clientA, { id: chunkId, documentId, chunkIndex: index });
    }

    await clientA.query(
      "UPDATE documents SET status = 'embedding', updated_at = now() WHERE id = $1 AND status = 'ready'",
      [documentId]
    );

    const readinessStart = Date.now();
    const readinessPromise = orchestrator.reembedDocument(documentId).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error };
      }
    );

    await sleep(150);
    assert.equal(settled, false, 'readiness is blocked behind the replacement lock');

    await clientA.query('COMMIT');
    const outcome = await readinessPromise;
    assert.ok(Date.now() - readinessStart >= 100, 'readiness waited for the replacement to commit');

    // The orchestrator re-verified after the lock and found: 2 chunks, 0
    // embeddings. It must fail closed rather than publish `ready`.
    const error = outcome.error ?? null;
    const value = outcome.value ?? null;
    if (error) {
      assert.ok(error instanceof Error);
    } else {
      assert.equal(value?.status, 'failed', 'a replaced chunk set is not published ready');
    }
  } finally {
    await releaseClient(clientA);
  }

  const state = await readReadinessState(pool, documentId, SPACE_ID);
  assert.equal(state.chunkCount, 2);
  assert.equal(state.embeddedCount, 0);
  assert.notEqual(state.status, 'ready', 'never ready while the current chunk set is unembedded');
});

test('raced re-embed and replacement never publish a ready document with unembedded chunks', async (t) => {
  if (skipReason) {
    return t.skip(skipReason);
  }

  const chunkRepository = new ChunkRepository(pool);

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const { documentId } = await seedReadyDocument();
    const { orchestrator } = createReadyStack();

    await Promise.allSettled([
      orchestrator.reembedDocument(documentId),
      chunkRepository.replaceDocumentChunks(documentId, [
        { chunkIndex: 1, content: 'r1', characterCount: 2 },
        { chunkIndex: 2, content: 'r2', characterCount: 2 }
      ])
    ]);

    const state = await readReadinessState(pool, documentId, SPACE_ID);

    assert.ok(
      state.status === 'ready' || state.status === 'embedding' || state.status === 'failed',
      `unexpected terminal status "${state.status}"`
    );

    if (state.status === 'ready') {
      assert.equal(
        state.embeddedCount,
        state.chunkCount,
        'a committed ready document must have every current chunk embedded'
      );
    }
  }
});
