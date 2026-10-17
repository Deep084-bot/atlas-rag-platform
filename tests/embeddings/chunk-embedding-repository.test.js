import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChunkEmbeddingRepository } from '../../server/embeddings/chunkEmbeddingRepository.js';
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

test('upsertChunkEmbedding derives document_id from the chunk and upserts', async () => {
  const rowDate = new Date('2026-10-17T00:00:00.000Z');
  const pool = createPool(() => ({
    rows: [{
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      space_id: 'voyage-4-lite-query-document-l2-1024-v1',
      l2_norm: '3.2',
      created_at: rowDate,
      updated_at: rowDate
    }]
  }));
  const repo = new ChunkEmbeddingRepository(pool);

  const result = await repo.upsertChunkEmbedding({
    chunkId: 'chunk-1',
    spaceId: 'voyage-4-lite-query-document-l2-1024-v1',
    embedding: [0.1, 0.2],
    l2Norm: 3.2
  });

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /INSERT INTO chunk_embeddings/);
  assert.match(sql, /SELECT c\.id, c\.document_id, \$2, \$3::vector, \$4/);
  assert.match(sql, /ON CONFLICT \(chunk_id, space_id\)/);
  assert.match(sql, /updated_at = now\(\)/);
  assert.deepEqual(params.slice(0, 2), ['chunk-1', 'voyage-4-lite-query-document-l2-1024-v1']);
  assert.equal(params[2], '[0.1,0.2]');
  assert.equal(params[3], 3.2);

  assert.deepEqual(result, {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    spaceId: 'voyage-4-lite-query-document-l2-1024-v1',
    l2Norm: 3.2,
    createdAt: rowDate,
    updatedAt: rowDate
  });
});

test('upsertChunkEmbedding returns null when the chunk no longer exists', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const result = await repo.upsertChunkEmbedding({
    chunkId: 'gone',
    spaceId: 'voyage-4-lite-query-document-l2-1024-v1',
    embedding: [0.1],
    l2Norm: 0.1
  });

  assert.equal(result, null);
});

test('upsertChunkEmbedding rejects invalid input', async () => {
  const repo = new ChunkEmbeddingRepository(createPool());

  await assert.rejects(
    () => repo.upsertChunkEmbedding({ chunkId: 'c1', spaceId: '', embedding: [0.1], l2Norm: 0.1 }),
    ValidationError
  );

  await assert.rejects(
    () => repo.upsertChunkEmbedding({ chunkId: 'c1', spaceId: 'space', embedding: [], l2Norm: 0.1 }),
    ValidationError
  );
});

test('upsertChunkEmbedding throws when the pool is not configured', async () => {
  const repo = new ChunkEmbeddingRepository(null);

  await assert.rejects(
    () => repo.upsertChunkEmbedding({ chunkId: 'c1', spaceId: 'space', embedding: [0.1], l2Norm: 0.1 }),
    DatabaseError
  );
});

test('countChunksWithEmbedding is scoped to document and space', async () => {
  const pool = createPool(() => ({ rows: [{ embedded_chunks: 4 }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const count = await repo.countChunksWithEmbedding('doc-1', 'space-1');

  assert.equal(count, 4);
  const [{ sql, params }] = pool.calls;
  assert.match(sql, /WHERE document_id = \$1/);
  assert.match(sql, /AND space_id = \$2/);
  assert.deepEqual(params, ['doc-1', 'space-1']);
});

test('upsertChunkEmbedding runs on the supplied transaction client instead of the pool', async () => {
  const pool = createPool(() => ({ rows: [] }));
  const client = createPool(() => ({ rows: [{
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    space_id: 'space-1',
    l2_norm: 1,
    created_at: null,
    updated_at: null
  }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const result = await repo.upsertChunkEmbedding({
    chunkId: 'chunk-1',
    spaceId: 'space-1',
    embedding: [0.1],
    l2Norm: 1
  }, { client });

  assert.equal(pool.calls.length, 0);
  assert.equal(client.calls.length, 1);
  assert.equal(result.chunkId, 'chunk-1');
});

test('a transaction client works even when the pool is not configured', async () => {
  const client = createPool(() => ({ rows: [{
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    space_id: 'space-1',
    l2_norm: 1,
    created_at: null,
    updated_at: null
  }] }));
  const repo = new ChunkEmbeddingRepository(null);

  const result = await repo.upsertChunkEmbedding({
    chunkId: 'chunk-1',
    spaceId: 'space-1',
    embedding: [0.1],
    l2Norm: 1
  }, { client });

  assert.equal(result.chunkId, 'chunk-1');
  assert.equal(client.calls.length, 1);
});

test('upsertChunkEmbedding rejects a non-finite L2 norm', async () => {
  const repo = new ChunkEmbeddingRepository(createPool());

  await assert.rejects(
    () => repo.upsertChunkEmbedding({ chunkId: 'c1', spaceId: 'space', embedding: [0.1], l2Norm: Number.NaN }),
    ValidationError
  );
});

test('findChunkIdsMissingEmbedding returns the ids of chunks without a row for the space', async () => {
  const pool = createPool(() => ({ rows: [{ chunk_id: 'c2' }, { chunk_id: 'c3' }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const ids = await repo.findChunkIdsMissingEmbedding('doc-1', 'space-1');

  assert.deepEqual(ids, ['c2', 'c3']);
  const [{ sql, params }] = pool.calls;
  assert.match(sql, /LEFT JOIN chunk_embeddings ce/);
  assert.match(sql, /AND ce\.space_id = \$2/);
  assert.match(sql, /AND ce\.chunk_id IS NULL/);
  assert.deepEqual(params, ['doc-1', 'space-1']);
});

test('findChunkIdsMissingEmbedding validates its inputs', async () => {
  const repo = new ChunkEmbeddingRepository(createPool());

  await assert.rejects(() => repo.findChunkIdsMissingEmbedding('', 'space'), ValidationError);
  await assert.rejects(() => repo.findChunkIdsMissingEmbedding('doc', ''), ValidationError);
});

test('findChunkIdsMissingEmbedding throws when neither pool nor client is configured', async () => {
  const repo = new ChunkEmbeddingRepository(null);

  await assert.rejects(
    () => repo.findChunkIdsMissingEmbedding('doc', 'space'),
    DatabaseError
  );
});

test('isDocumentFullyEmbedded reports complete when every chunk has a row for the space', async () => {
  const pool = createPool(() => ({ rows: [{ total_chunks: 3, embedded_chunks: 3 }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const verification = await repo.isDocumentFullyEmbedded('doc-1', 'space-1');

  assert.deepEqual(verification, { totalChunks: 3, embeddedChunks: 3, missingChunks: 0, complete: true });
  const [{ sql, params }] = pool.calls;
  assert.match(sql, /LEFT JOIN chunk_embeddings ce/);
  assert.match(sql, /AND ce\.space_id = \$2/);
  assert.match(sql, /COUNT\(ce\.chunk_id\)::int AS embedded_chunks/);
  assert.deepEqual(params, ['doc-1', 'space-1']);
});

test('isDocumentFullyEmbedded is incomplete when a chunk lacks a row even if counts differ', async () => {
  const pool = createPool(() => ({ rows: [{ total_chunks: 3, embedded_chunks: 2 }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const verification = await repo.isDocumentFullyEmbedded('doc-1', 'space-1');

  assert.deepEqual(verification, { totalChunks: 3, embeddedChunks: 2, missingChunks: 1, complete: false });
});

test('isDocumentFullyEmbedded treats an empty document as complete', async () => {
  const pool = createPool(() => ({ rows: [{ total_chunks: 0, embedded_chunks: 0 }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const verification = await repo.isDocumentFullyEmbedded('doc-1', 'space-1');

  assert.deepEqual(verification, { totalChunks: 0, embeddedChunks: 0, missingChunks: 0, complete: true });
});

test('isDocumentFullyEmbedded validates its inputs and the queryable', async () => {
  const repo = new ChunkEmbeddingRepository(createPool());

  await assert.rejects(() => repo.isDocumentFullyEmbedded('', 'space'), ValidationError);
  await assert.rejects(() => repo.isDocumentFullyEmbedded('doc', ''), ValidationError);
  await assert.rejects(
    () => new ChunkEmbeddingRepository(null).isDocumentFullyEmbedded('doc', 'space'),
    DatabaseError
  );
});

test('isDocumentFullyEmbedded runs on the supplied transaction client', async () => {
  const pool = createPool();
  const client = createPool(() => ({ rows: [{ total_chunks: 1, embedded_chunks: 1 }] }));
  const repo = new ChunkEmbeddingRepository(pool);

  const verification = await repo.isDocumentFullyEmbedded('doc-1', 'space-1', { client });

  assert.equal(verification.complete, true);
  assert.equal(client.calls.length, 1);
  assert.equal(pool.calls.length, 0);
});
