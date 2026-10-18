import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';

function createFakePool({ locked = true } = {}) {
  const queries = [];
  const client = {
    async query(text, params) {
      queries.push({ text, params });

      if (text.includes('FOR UPDATE')) {
        return { rows: locked ? [{ id: 'doc-1' }] : [] };
      }

      if (text.includes('INSERT INTO chunks')) {
        return {
          rows: [
            {
              id: 'chunk-1',
              document_id: 'doc-1',
              chunk_index: 0,
              content: 'hello',
              character_count: 5,
              created_at: '2024-01-01T00:00:00.000Z'
            }
          ]
        };
      }

      return { rows: [] };
    },
    release() {}
  };

  return {
    queries,
    pool: { connect: async () => client, query: async () => ({ rows: [] }) }
  };
}

const replacement = [{ chunkIndex: 0, content: 'hello', characterCount: 5 }];

test('demotes a ready document to embedding inside the replacement transaction', async () => {
  const { pool, queries } = createFakePool();
  const repository = new ChunkRepository(pool);

  await repository.replaceDocumentChunks('doc-1', replacement);

  const demoteIndex = queries.findIndex(
    (q) => q.text.includes("SET status = 'embedding'") && q.text.includes("status = 'ready'")
  );

  assert.notEqual(demoteIndex, -1, 'ready -> embedding guarded update is issued');
  assert.ok(
    demoteIndex < queries.findIndex((q) => q.text === 'COMMIT'),
    'the demotion is part of the same transaction (before COMMIT)'
  );

  const demote = queries[demoteIndex];
  assert.deepEqual(demote.params, ['doc-1']);
  assert.ok(demote.text.includes('LEAST(progress, 90)'), 'progress is clamped without increasing it');
});

test('the demotion never runs before the chunks are deleted', async () => {
  const { pool, queries } = createFakePool();

  await new ChunkRepository(pool).replaceDocumentChunks('doc-1', replacement);

  const deleteIndex = queries.findIndex((q) => q.text.includes('DELETE FROM chunks'));
  const demoteIndex = queries.findIndex((q) => q.text.includes("SET status = 'embedding'"));

  assert.ok(deleteIndex < demoteIndex, 'chunks are replaced before readiness is invalidated');
});

test('a missing document rolls back without inserting chunks or demoting status', async () => {
  const { pool, queries } = createFakePool({ locked: false });

  const result = await new ChunkRepository(pool).replaceDocumentChunks('doc-1', replacement);

  assert.deepEqual(result, []);
  assert.ok(queries.some((q) => q.text === 'ROLLBACK'));
  assert.equal(queries.some((q) => q.text === 'COMMIT'), false);
  assert.equal(queries.some((q) => q.text.includes('INSERT INTO chunks')), false);
  assert.equal(queries.some((q) => q.text.includes("SET status = 'embedding'")), false);
});

test('a replacement commits exactly once, after the status demotion', async () => {
  const { pool, queries } = createFakePool();

  await new ChunkRepository(pool).replaceDocumentChunks('doc-1', replacement);

  const commits = queries.filter((q) => q.text === 'COMMIT');
  assert.equal(commits.length, 1);

  const lastMutation = queries.findLastIndex(
    (q) => q.text.includes("SET status = 'embedding'")
  );
  assert.ok(queries.findIndex((q) => q.text === 'COMMIT') > lastMutation);
});
