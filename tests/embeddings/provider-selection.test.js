import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { EMBEDDING_MANIFEST } from '../../server/embeddings/embeddingManifest.js';
import { HuggingFaceProvider } from '../../server/embeddings/HuggingFaceProvider.js';
import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';
import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';

function writePinnedArtifacts(cacheDir) {
  for (const artifact of EMBEDDING_MANIFEST.artifacts) {
    const target = path.join(
      cacheDir,
      'Xenova',
      'bge-small-en-v1.5',
      EMBEDDING_MANIFEST.model.revision,
      artifact.path
    );

    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '');
    truncateSync(target, artifact.bytes);
  }
}

function makeTempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-embedding-cache-'));

  t.after(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

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

test('local provider honors configuration overrides', (t) => {
  const root = makeTempDir(t);
  const configured = path.join(root, 'configured-cache');
  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      LOCAL_EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2',
      EMBEDDING_LOCAL_POOLING: 'mean',
      EMBEDDING_LOCAL_QUANTIZED: 'true',
      EMBEDDING_CACHE_DIR: configured,
      EMBEDDING_BUNDLED_CACHE_DIR: path.join(root, 'empty-bundle')
    }
  });

  assert.equal(provider.model, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(provider.pooling, 'mean');
  assert.equal(provider.quantized, true);
  assert.equal(provider.cacheDir, configured);
});

test('uses the bundled cache when the configured cache lacks pinned artifacts', (t) => {
  const root = makeTempDir(t);
  const bundled = path.join(root, 'model-cache');
  const unusable = path.join(root, 'var-data');
  writePinnedArtifacts(bundled);

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: unusable,
      EMBEDDING_BUNDLED_CACHE_DIR: bundled
    }
  });

  assert.equal(provider.cacheDir, bundled);
  assert.equal(provider.allowRemoteModels, false);
  assert.equal(provider.revision, EMBEDDING_MANIFEST.model.revision);
});

test('prefers a configured cache that already contains pinned artifacts', (t) => {
  const root = makeTempDir(t);
  const bundled = path.join(root, 'model-cache');
  const persistent = path.join(root, 'persistent-cache');
  writePinnedArtifacts(bundled);
  writePinnedArtifacts(persistent);

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: persistent,
      EMBEDDING_BUNDLED_CACHE_DIR: bundled
    }
  });

  assert.equal(provider.cacheDir, persistent);
  assert.equal(provider.allowRemoteModels, false);
});

test('allows remote download only when explicitly enabled', (t) => {
  const root = makeTempDir(t);
  const configured = path.join(root, 'configured-cache');

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: configured,
      EMBEDDING_BUNDLED_CACHE_DIR: path.join(root, 'empty-bundle'),
      EMBEDDING_LOCAL_ALLOW_REMOTE: 'true'
    }
  });

  assert.equal(provider.allowRemoteModels, true);
});

test('uses the configured cache when no bundled artifacts exist', (t) => {
  const root = makeTempDir(t);
  const configured = path.join(root, 'configured-cache');

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: configured,
      EMBEDDING_BUNDLED_CACHE_DIR: path.join(root, 'empty-bundle'),
      EMBEDDING_LOCAL_ALLOW_REMOTE: 'false'
    }
  });

  assert.equal(provider.cacheDir, configured);
  assert.equal(provider.allowRemoteModels, false);
});

test('a truncated configured cache falls back to the bundled cache', (t) => {
  const root = makeTempDir(t);
  const bundled = path.join(root, 'model-cache');
  const truncated = path.join(root, 'truncated-cache');
  writePinnedArtifacts(bundled);
  writePinnedArtifacts(truncated);

  const artifact = EMBEDDING_MANIFEST.artifacts.at(-1);
  truncateSync(path.join(
    truncated,
    'Xenova',
    'bge-small-en-v1.5',
    EMBEDDING_MANIFEST.model.revision,
    artifact.path
  ), artifact.bytes - 1);

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: truncated,
      EMBEDDING_BUNDLED_CACHE_DIR: bundled
    }
  });

  assert.equal(provider.cacheDir, bundled);
  assert.equal(provider.allowRemoteModels, false);
});

test('pins the manifest revision for local mode by default', () => {
  const provider = createEmbeddingProvider({
    env: { EMBEDDING_PROVIDER: 'local', EMBEDDING_BUNDLED_CACHE_DIR: '/nonexistent' }
  });

  assert.equal(provider.revision, EMBEDDING_MANIFEST.model.revision);
});

test('a same-size corrupted configured cache is selected and rejected by strict verification', async (t) => {
  const root = makeTempDir(t);
  const bundled = path.join(root, 'model-cache');
  const persistent = path.join(root, 'persistent-cache');
  writePinnedArtifacts(bundled);
  writePinnedArtifacts(persistent);

  const artifact = EMBEDDING_MANIFEST.artifacts.at(-1);
  writeFileSync(path.join(
    persistent,
    'Xenova',
    'bge-small-en-v1.5',
    EMBEDDING_MANIFEST.model.revision,
    artifact.path
  ), Buffer.alloc(artifact.bytes));

  const provider = createEmbeddingProvider({
    env: {
      EMBEDDING_PROVIDER: 'local',
      EMBEDDING_CACHE_DIR: persistent,
      EMBEDDING_BUNDLED_CACHE_DIR: bundled,
      EMBEDDING_LOCAL_STRICT: 'true'
    }
  });

  assert.equal(provider.cacheDir, persistent);
  await assert.rejects(
    () => provider.embed('hello'),
    /cache failed integrity verification.*checksum-mismatch/
  );
});
