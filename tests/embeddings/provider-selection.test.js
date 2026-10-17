import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { HuggingFaceProvider } from '../../server/embeddings/HuggingFaceProvider.js';
import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';
import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';

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

test('selects VoyageProvider for "voyage" when VOYAGE_API_KEY is set', () => {
  const provider = createEmbeddingProvider({
    env: { EMBEDDING_PROVIDER: 'voyage', VOYAGE_API_KEY: 'pa_secret' }
  });

  assert.ok(provider instanceof VoyageProvider);
  assert.equal(provider.apiKey, 'pa_secret');
  assert.equal(provider.model, 'voyage-4-lite');
});

test('voyage provider honors configuration overrides', () => {
  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'voyage',
      VOYAGE_API_KEY: 'pa_secret',
      VOYAGE_MODEL: 'voyage-4',
      VOYAGE_BASE_URL: 'https://example.test/v1',
      VOYAGE_OUTPUT_DIMENSION: '512',
      VOYAGE_INPUT_TYPE: 'document',
      VOYAGE_NORMALIZE: 'false'
    }
  });

  assert.equal(provider.model, 'voyage-4');
  assert.equal(provider.baseUrl, 'https://example.test/v1');
  assert.equal(provider.dimensions, 512);
  assert.equal(provider.inputType, 'document');
  assert.equal(provider.normalize, false);
});

test('voyage provider requires VOYAGE_API_KEY', () => {
  assert.throws(
    () => createEmbeddingProvider({ env: { EMBEDDING_PROVIDER: 'voyage' } }),
    /VOYAGE_API_KEY/
  );
});

test('voyage is not selected by default', () => {
  const provider = createEmbeddingProvider({ env: { VOYAGE_API_KEY: 'pa_secret' } });
  assert.ok(provider instanceof HuggingFaceProvider);
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
