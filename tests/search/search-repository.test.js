import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SearchRepository } from '../../server/search/searchRepository.js';

function createRecorder(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows };
    }
  };
}

test('space-aware search excludes legacy unknown vectors by default', async () => {
  const pool = createRecorder();
  const repository = new SearchRepository(pool);

  await repository.searchChunksByEmbeddingForUser({
    userId: 'user-1',
    embedding: [0.1, 0.2],
    spaceId: 'active-space'
  });

  assert.equal(pool.calls[0].params[5], false);
});

test('compatibility checks exclude legacy unknown vectors by default', async () => {
  const pool = createRecorder();
  const repository = new SearchRepository(pool);
  let summary;

  try {
    summary = await repository.summarizeIncompatibleEmbeddings({ spaceId: 'active-space' });
  } catch {
    // parses the recorded query below even when the recorder returns no COUNT row
  }

  assert.deepEqual(pool.calls[0].params, ['active-space', false]);
  assert.ok(summary);
});

test('legacy inclusion remains available as an explicit compatibility choice', async () => {
  const pool = createRecorder();
  const repository = new SearchRepository(pool);

  await repository.searchChunksByEmbeddingForUser({
    userId: 'user-1',
    embedding: [0.1, 0.2],
    spaceId: 'hosted-space',
    includeLegacyUnknown: true
  });

  assert.equal(pool.calls[0].params[5], true);
});
