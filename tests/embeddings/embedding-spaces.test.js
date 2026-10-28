import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_EMBEDDING_SPACE_ID,
  EMBEDDING_SPACES,
  HOSTED_BGE_SPACE_ID,
  LOCAL_BGE_SPACE_ID,
  VOYAGE_DIMENSIONS_DEFAULT,
  VOYAGE_SPACE_ID,
  expectedDimensionsForProvider,
  getEmbeddingSpace,
  resolveActiveEmbeddingSpace,
  resolveDimensionsForService,
  resolveEmbeddingSpaceForProvider,
  resolveLegacyUnknownPolicy,
  spaceIdForProvider,
  voyageSpaceId
} from '../../server/embeddings/embeddingSpaces.js';

test('registers distinct hosted/local BGE spaces and a versioned Voyage space', () => {
  assert.equal(HOSTED_BGE_SPACE_ID, 'bge-small-en-v1.5-hosted-l2-v1');
  assert.equal(LOCAL_BGE_SPACE_ID, 'bge-small-en-v1.5-mean-l2-int8-v1');
  assert.notEqual(HOSTED_BGE_SPACE_ID, LOCAL_BGE_SPACE_ID);
  assert.equal(DEFAULT_EMBEDDING_SPACE_ID, HOSTED_BGE_SPACE_ID);
  assert.equal(VOYAGE_SPACE_ID, voyageSpaceId(VOYAGE_DIMENSIONS_DEFAULT));
  assert.equal(VOYAGE_SPACE_ID, 'voyage-4-lite-query-document-l2-1024-v1');

  assert.equal(EMBEDDING_SPACES[HOSTED_BGE_SPACE_ID].dimensions, 384);
  assert.equal(EMBEDDING_SPACES[HOSTED_BGE_SPACE_ID].normalization, 'l2');
  assert.equal(EMBEDDING_SPACES[HOSTED_BGE_SPACE_ID].legacyUnknownPolicy, 'block');
  assert.deepEqual(EMBEDDING_SPACES[HOSTED_BGE_SPACE_ID].providers, ['huggingface']);
  assert.equal(EMBEDDING_SPACES[LOCAL_BGE_SPACE_ID].quantization, 'int8');
  assert.equal(EMBEDDING_SPACES[LOCAL_BGE_SPACE_ID].legacyUnknownPolicy, 'block');
  assert.deepEqual(EMBEDDING_SPACES[LOCAL_BGE_SPACE_ID].providers, ['local', 'local-transformers']);

  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].dimensions, 1024);
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].model, 'voyage-4-lite');
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].queryInputType, 'query');
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].documentInputType, 'document');
});

test('maps provider names to distinct hosted/local embedding space ids', () => {
  assert.equal(spaceIdForProvider('huggingface'), HOSTED_BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('local'), LOCAL_BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('local-transformers'), LOCAL_BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('voyage'), VOYAGE_SPACE_ID);
  assert.equal(spaceIdForProvider('unknown'), null);
});

test('resolves the active space from EMBEDDING_PROVIDER', () => {
  assert.equal(resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'huggingface' }).id, HOSTED_BGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'local' }).id, LOCAL_BGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'voyage' }).id, VOYAGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({}).id, HOSTED_BGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({}).legacyUnknownPolicy, 'block');
  assert.equal(resolveLegacyUnknownPolicy({}), 'block');
});

test('hosted legacy-unknown inclusion requires an explicit compatibility setting', () => {
  const compatible = resolveActiveEmbeddingSpace({
    EMBEDDING_PROVIDER: 'huggingface',
    EMBEDDING_LEGACY_UNKNOWN_POLICY: 'include'
  });

  assert.equal(compatible.id, HOSTED_BGE_SPACE_ID);
  assert.equal(compatible.legacyUnknownPolicy, 'include');
  assert.equal(EMBEDDING_SPACES[HOSTED_BGE_SPACE_ID].legacyUnknownPolicy, 'block', 'the default registry is never mutated');
});

test('legacy-unknown compatibility cannot be enabled for local or Voyage spaces', () => {
  assert.throws(
    () => resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'local', EMBEDDING_LEGACY_UNKNOWN_POLICY: 'include' }),
    /only supported for the hosted BGE space/
  );
  assert.throws(
    () => resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'voyage', EMBEDDING_LEGACY_UNKNOWN_POLICY: 'include' }),
    /only supported for the hosted BGE space/
  );
});

test('invalid legacy-unknown policy values fail closed', () => {
  assert.throws(
    () => resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'huggingface', EMBEDDING_LEGACY_UNKNOWN_POLICY: 'assume' }),
    /must be "block" or "include"/
  );
});

test('voyage output dimension override produces a derived space id', () => {
  const space = resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'voyage', VOYAGE_OUTPUT_DIMENSION: '512' });

  assert.equal(space.dimensions, 512);
  assert.equal(space.id, 'voyage-4-lite-query-document-l2-512-v1');
  assert.equal(space.derivedFrom, VOYAGE_SPACE_ID);
});

test('resolveDimensionsForService prefers explicit dimensions, then provider, then env', () => {
  assert.equal(resolveDimensionsForService({ dimensions: 2048 }), 2048);
  assert.equal(resolveDimensionsForService({ provider: { dimensions: 512 } }), 512);
  assert.equal(resolveDimensionsForService({ provider: { dimensions: null } }), 384);
  assert.equal(resolveDimensionsForService({ env: { EMBEDDING_PROVIDER: 'voyage' } }), 1024);
  assert.equal(expectedDimensionsForProvider('voyage'), 1024);
  assert.equal(expectedDimensionsForProvider('local'), 384);
});

test('getEmbeddingSpace returns null for unknown ids', () => {
  assert.equal(getEmbeddingSpace('nope'), null);
  assert.equal(getEmbeddingSpace(undefined), null);
  assert.equal(resolveEmbeddingSpaceForProvider('local').kind, 'bge');
});
