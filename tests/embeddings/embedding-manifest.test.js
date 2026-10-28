import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  hasPinnedArtifacts,
  resolveBundledCacheDir,
  sha256Buffer,
  verifyArtifacts
} from '../../server/embeddings/embeddingManifest.js';

const ARTIFACT_PATH = 'config.json';
const ARTIFACT_BODY = Buffer.from('{"hidden_size":384}');
const REVISION = 'test-revision';

function makeManifest(extraArtifact = null) {
  const artifacts = [
    {
      path: ARTIFACT_PATH,
      bytes: ARTIFACT_BODY.length,
      sha256: sha256Buffer(ARTIFACT_BODY)
    }
  ];

  if (extraArtifact) {
    artifacts.push(extraArtifact);
  }

  return {
    model: {
      repository: 'Xenova/bge-small-en-v1.5',
      revision: REVISION
    },
    artifacts
  };
}

function makeCache(t) {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'atlas-manifest-test-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const modelDir = path.join(cacheDir, 'Xenova', 'bge-small-en-v1.5', REVISION);
  mkdirSync(modelDir, { recursive: true });
  return { cacheDir, modelDir };
}

function writeArtifact(modelDir, body) {
  writeFileSync(path.join(modelDir, ARTIFACT_PATH), body);
}

test('verifyArtifacts accepts a valid pinned cache', async (t) => {
  const { cacheDir, modelDir } = makeCache(t);
  writeArtifact(modelDir, ARTIFACT_BODY);

  const result = await verifyArtifacts({ cacheDir, manifest: makeManifest() });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.checked[0].ok, true);
});

test('verifyArtifacts rejects a missing artifact', async (t) => {
  const { cacheDir } = makeCache(t);

  const result = await verifyArtifacts({ cacheDir, manifest: makeManifest() });

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].reason, 'missing');
});

test('verifyArtifacts rejects a truncated artifact', async (t) => {
  const { cacheDir, modelDir } = makeCache(t);
  writeArtifact(modelDir, ARTIFACT_BODY);
  truncateSync(path.join(modelDir, ARTIFACT_PATH), ARTIFACT_BODY.length - 1);

  const result = await verifyArtifacts({ cacheDir, manifest: makeManifest() });

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].reason, 'size-mismatch');
});

test('verifyArtifacts rejects a same-size corrupted artifact', async (t) => {
  const { cacheDir, modelDir } = makeCache(t);
  const corrupted = Buffer.from(ARTIFACT_BODY);
  corrupted[0] = 'X'.charCodeAt(0);
  writeArtifact(modelDir, corrupted);

  const result = await verifyArtifacts({ cacheDir, manifest: makeManifest() });

  assert.equal(result.ok, false);
  assert.equal(result.failures[0].reason, 'checksum-mismatch');
});

test('hasPinnedArtifacts requires every artifact to exist at the exact pinned size', (t) => {
  const { cacheDir, modelDir } = makeCache(t);
  const manifest = makeManifest();
  writeArtifact(modelDir, ARTIFACT_BODY);

  assert.equal(hasPinnedArtifacts(cacheDir, manifest), true);

  truncateSync(path.join(modelDir, ARTIFACT_PATH), ARTIFACT_BODY.length - 1);
  assert.equal(hasPinnedArtifacts(cacheDir, manifest), false);

  rmSync(path.join(modelDir, ARTIFACT_PATH));
  assert.equal(hasPinnedArtifacts(cacheDir, manifest), false);
});

test('resolveBundledCacheDir honors the configured bundle directory', () => {
  assert.equal(
    resolveBundledCacheDir({ env: { EMBEDDING_BUNDLED_CACHE_DIR: '/tmp/atlas-bundle' }, cwd: '/app' }),
    path.resolve('/tmp/atlas-bundle')
  );
  assert.equal(
    resolveBundledCacheDir({ env: { ATLAS_MODEL_CACHE_DIR: 'bundles/model' }, cwd: '/app' }),
    path.resolve('/app/bundles/model')
  );
  assert.equal(
    resolveBundledCacheDir({ env: {}, cwd: '/app' }),
    path.join('/app', 'model-cache')
  );
});
