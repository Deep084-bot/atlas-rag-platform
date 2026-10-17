import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BGE_SPACE_ID,
  DEFAULT_EMBEDDING_SPACE_ID,
  EMBEDDING_SPACES,
  VOYAGE_DIMENSIONS_DEFAULT,
  VOYAGE_SPACE_ID,
  expectedDimensionsForProvider,
  getEmbeddingSpace,
  resolveActiveEmbeddingSpace,
  resolveDimensionsForService,
  resolveEmbeddingSpaceForProvider,
  spaceIdForProvider,
  voyageSpaceId
} from '../../server/embeddings/embeddingSpaces.js';

test('registers a versioned BGE space and a versioned Voyage space', () => {
  assert.equal(BGE_SPACE_ID, 'bge-small-en-v1.5-mean-l2-int8-v1');
  assert.equal(BGE_SPACE_ID, DEFAULT_EMBEDDING_SPACE_ID);
  assert.equal(VOYAGE_SPACE_ID, voyageSpaceId(VOYAGE_DIMENSIONS_DEFAULT));
  assert.equal(VOYAGE_SPACE_ID, 'voyage-4-lite-query-document-l2-1024-v1');

  assert.equal(EMBEDDING_SPACES[BGE_SPACE_ID].dimensions, 384);
  assert.equal(EMBEDDING_SPACES[BGE_SPACE_ID].normalization, 'l2');

  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].dimensions, 1024);
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].model, 'voyage-4-lite');
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].queryInputType, 'query');
  assert.equal(EMBEDDING_SPACES[VOYAGE_SPACE_ID].documentInputType, 'document');
});

test('maps provider names to the expected embedding space ids', () => {
  assert.equal(spaceIdForProvider('huggingface'), BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('local'), BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('local-transformers'), BGE_SPACE_ID);
  assert.equal(spaceIdForProvider('voyage'), VOYAGE_SPACE_ID);
  assert.equal(spaceIdForProvider('unknown'), null);
});

test('resolves the active space from EMBEDDING_PROVIDER', () => {
  assert.equal(resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'huggingface' }).id, BGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({ EMBEDDING_PROVIDER: 'voyage' }).id, VOYAGE_SPACE_ID);
  assert.equal(resolveActiveEmbeddingSpace({}).id, BGE_SPACE_ID);
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
