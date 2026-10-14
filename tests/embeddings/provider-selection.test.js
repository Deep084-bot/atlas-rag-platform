import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { HuggingFaceProvider } from '../../server/embeddings/HuggingFaceProvider.js';
import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';

test('defaults to HuggingFaceProvider when EMBEDDING_PROVIDER is unset', () => {
  const provider = createEmbeddingProvider({ env: {} });

  assert.ok(provider instanceof HuggingFaceProvider);
});

test('selects HuggingFaceProvider for "huggingface"', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'huggingface' } });

  assert.ok(provider instanceof HuggingFaceProvider);
});

test('selects LocalTransformersProvider for "local"', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'local' } });

  assert.ok(provider instanceof LocalTransformersProvider);
});

test('selects LocalTransformersProvider for "local-transformers" alias', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'local-transformers' } });

  assert.ok(provider instanceof LocalTransformersProvider);
});

test('provider name matching is case-insensitive and trimmed', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: '  LOCAL ' } });

  assert.ok(provider instanceof LocalTransformersProvider);
});

test('throws a clear error for unsupported provider names', () => {
  assert.throws(
    () => createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'openai' } }),
    /Unsupported EMBEDDING_PROVIDER "openai"/
  );
});

test('does not silently fall back to Hugging Face for unknown names', () => {
  assert.throws(() => createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'local2' } }));
});

test('local provider does not require HF_API_KEY', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'local' } });

  assert.ok(provider instanceof LocalTransformersProvider);
  assert.equal(provider.apiKey, undefined);
});

test('passes HF_API_KEY through to the Hugging Face provider', () => {
  const provider = createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'huggingface', HF_API_KEY: 'hf_secret' } });

  assert.ok(provider instanceof HuggingFaceProvider);
  assert.equal(provider.apiKey, 'hf_secret');
});

test('local provider honors configuration overrides', () => {
  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      LOCAL_EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2',
      EMBEDDING_LOCAL_POOLING: 'mean',
      EMBEDDING_LOCAL_QUANTIZED: 'true',
      EMBEDDING_CACHE_DIR: '/tmp/atlas-embeddings'
    }
  });

  assert.equal(provider.model, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(provider.pooling, 'mean');
  assert.equal(provider.quantized, true);
  assert.equal(provider.cacheDir, '/tmp/atlas-embeddings');
});
