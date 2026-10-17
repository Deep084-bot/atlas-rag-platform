import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbeddingReconciliation } from '../../server/documents/embeddingReconciliation.js';
import { DatabaseError, ValidationError } from '../../server/errors.js';

function createPool(handler) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(sql, params);
    }
  };
}

test('findReadyDocumentsMissingEmbeddings reports per-document gaps', async () => {
  const pool = createPool(() => ({
    rows: [
      { document_id: 'doc-1', total_chunks: 5, embedded_chunks: 3 },
      { document_id: 'doc-2', total_chunks: 2, embedded_chunks: 0 }
    ]
  }));
  const reconciliation = new EmbeddingReconciliation(pool);

  const missing = await reconciliation.findReadyDocumentsMissingEmbeddings({
    spaceId: 'voyage-4-lite-query-document-l2-1024-v1'
  });

  assert.deepEqual(missing, [
    { documentId: 'doc-1', totalChunks: 5, embeddedChunks: 3, missingChunks: 2 },
    { documentId: 'doc-2', totalChunks: 2, embeddedChunks: 0, missingChunks: 2 }
  ]);

  const [{ sql, params }] = pool.calls;
  assert.match(sql, /d\.status = 'ready'/);
  assert.match(sql, /ce\.space_id = \$1/);
  assert.equal(params[0], 'voyage-4-lite-query-document-l2-1024-v1');
  assert.equal(params[1], 100);
});

test('findReadyDocumentsMissingEmbeddings requires a spaceId', async () => {
  const reconciliation = new EmbeddingReconciliation(createPool(() => ({ rows: [] })));

  await assert.rejects(
    () => reconciliation.findReadyDocumentsMissingEmbeddings({}),
    ValidationError
  );
});

test('countOrphanedChunkEmbeddings returns the orphan count', async () => {
  const pool = createPool(() => ({ rows: [{ orphaned: 0 }] }));
  const reconciliation = new EmbeddingReconciliation(pool);

  const orphans = await reconciliation.countOrphanedChunkEmbeddings();

  assert.equal(orphans, 0);
  assert.match(pool.calls[0].sql, /WHERE c\.id IS NULL/);
});

test('reconciliation throws when the pool is not configured', async () => {
  const reconciliation = new EmbeddingReconciliation(null);

  await assert.rejects(
    () => reconciliation.findReadyDocumentsMissingEmbeddings({ spaceId: 'space' }),
    DatabaseError
  );
  await assert.rejects(() => reconciliation.countOrphanedChunkEmbeddings(), DatabaseError);
});
