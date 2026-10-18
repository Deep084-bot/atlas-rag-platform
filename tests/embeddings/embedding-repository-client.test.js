import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { DatabaseError } from '../../server/errors.js';

function createRecorder(rows) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows };
    }
  };
}

test('countTotalChunks uses the provided transaction client instead of the pool', async () => {
  const pool = createRecorder([{ total_chunks: 99 }]);
  const client = createRecorder([{ total_chunks: 3 }]);
  const repository = new EmbeddingRepository(pool);

  const total = await repository.countTotalChunks('doc-1', { client });

  assert.equal(total, 3);
  assert.equal(pool.calls.length, 0, 'the pool is never touched when a client is supplied');
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].params, ['doc-1']);
});

test('countEmbeddedChunks uses the provided transaction client instead of the pool', async () => {
  const pool = createRecorder([{ embedded_chunks: 99 }]);
  const client = createRecorder([{ embedded_chunks: 2 }]);
  const repository = new EmbeddingRepository(pool);

  const embedded = await repository.countEmbeddedChunks('doc-1', { client });

  assert.equal(embedded, 2);
  assert.equal(pool.calls.length, 0);
  assert.equal(client.calls.length, 1);
});

test('count helpers fall back to the pool and default to zero without rows', async () => {
  const pool = createRecorder([]);
  const repository = new EmbeddingRepository(pool);

  assert.equal(await repository.countTotalChunks('doc-1'), 0);
  assert.equal(await repository.countEmbeddedChunks('doc-1'), 0);
  assert.equal(pool.calls.length, 2);
});

test('count helpers fail closed when neither a pool nor a client is available', async () => {
  const repository = new EmbeddingRepository(null);

  await assert.rejects(() => repository.countTotalChunks('doc-1'), DatabaseError);
  await assert.rejects(() => repository.countEmbeddedChunks('doc-1'), DatabaseError);
});
