import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const ROOT = new URL('../../', import.meta.url);

async function readScript(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('staging seed scripts never write vectors without provenance', async () => {
  for (const path of ['scripts/dev/seed-staging-corpus.mjs', 'scripts/dev/seed-eval-corpus.mjs']) {
    const source = await readScript(path);

    assert.doesNotMatch(source, /SET\s+embedding\s*=/i, `${path} must not write chunks.embedding directly`);
    assert.match(source, /updateChunkEmbedding\([\s\S]*?spaceId:\s*space\.id/, `${path} must persist the active space`);
    assert.match(source, /embedding_space_id IS DISTINCT FROM \$2/, `${path} must refuse readiness without full provenance`);
  }
});

test('the local pipeline exercises the active local space for writes and reads', async () => {
  const source = await readScript('scripts/dev/local-pipeline-e2e.mjs');

  assert.match(source, /resolveEmbeddingSpaceForProvider\('local'\)/);
  assert.match(source, /createEmbeddingService\(\{[\s\S]*?space,/, 'ingestion must write with the active space');
  assert.match(source, /createSearchService\(\{[\s\S]*?space,/, 'retrieval must read with the active space');
  assert.match(source, /allTaggedWithActiveSpace/);
  assert.match(source, /embedding_space_id/);
});
