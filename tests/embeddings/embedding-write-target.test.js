import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeEmbeddingL2Norm,
  isTableSpace,
  LEGACY_STORAGE_KIND,
  resolveEmbeddingWriteTarget,
  TABLE_STORAGE_KIND
} from '../../server/embeddings/embeddingWriteTarget.js';
import { BGE_SPACE, VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ValidationError } from '../../server/errors.js';

test('BGE resolves to the legacy storage column', () => {
  const target = resolveEmbeddingWriteTarget(BGE_SPACE);

  assert.equal(target.kind, LEGACY_STORAGE_KIND);
  assert.equal(target.column, 'embedding');
  assert.equal(target.spaceId, BGE_SPACE.id);
  assert.equal(target.dimensions, 384);
  assert.equal(isTableSpace(BGE_SPACE), false);
});

test('Voyage resolves to the chunk_embeddings table with bound input types', () => {
  const target = resolveEmbeddingWriteTarget(VOYAGE_SPACE);

  assert.equal(target.kind, TABLE_STORAGE_KIND);
  assert.equal(target.table, 'chunk_embeddings');
  assert.equal(target.spaceId, VOYAGE_SPACE.id);
  assert.equal(target.dimensions, 1024);
  assert.equal(target.queryInputType, 'query');
  assert.equal(target.documentInputType, 'document');
  assert.equal(isTableSpace(VOYAGE_SPACE), true);
});

test('resolveEmbeddingWriteTarget rejects spaces without id or dimensions', () => {
  assert.throws(() => resolveEmbeddingWriteTarget(null), ValidationError);
  assert.throws(() => resolveEmbeddingWriteTarget({ id: '', dimensions: 384 }), ValidationError);
  assert.throws(() => resolveEmbeddingWriteTarget({ id: 'space', dimensions: 0 }), ValidationError);
});

test('computeEmbeddingL2Norm normalizes to unit length', () => {
  const norm = computeEmbeddingL2Norm([3, 4]);
  assert.equal(norm, 5);
});

test('computeEmbeddingL2Norm rejects malformed embeddings', () => {
  assert.throws(() => computeEmbeddingL2Norm([], {}), ValidationError);
  assert.throws(() => computeEmbeddingL2Norm([1, Infinity], {}), ValidationError);
  assert.throws(() => computeEmbeddingL2Norm([1, 2], { dimensions: 3 }), ValidationError);
});
