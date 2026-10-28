/**
 * In-container runtime smoke test (dev-only, not part of production build).
 *
 * Loads the real local embedding model, then boots the Express app and checks
 * that /api/health stays responsive after model loading. Reports init time,
 * RSS, and (when available) cgroup memory.
 *
 * Env:
 *   EMBEDDING_CACHE_DIR
 *   EMBEDDING_LOCAL_QUANTIZED   "true" to use model_quantized.onnx
 *   EMBEDDING_LOCAL_POOLING     default "mean"
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  EMBEDDING_MANIFEST,
  parseBoolean,
  resolveArtifactPath,
  resolveBundledCacheDir
} from '../../server/embeddings/embeddingManifest.js';

function readCgroup() {
  const out = {};
  for (const [label, file] of [
    ['max', '/sys/fs/cgroup/memory.max'],
    ['current', '/sys/fs/cgroup/memory.current'],
    ['limitV1', '/sys/fs/cgroup/memory/memory.limit_in_bytes'],
    ['usageV1', '/sys/fs/cgroup/memory/memory.usage_in_bytes']
  ]) {
    try {
      out[label] = fs.readFileSync(file, 'utf8').trim();
    } catch {
      // cgroup file not present
    }
  }
  return out;
}

const MODEL = EMBEDDING_MANIFEST.model.repository;
const REVISION = process.env.EMBEDDING_LOCAL_REVISION || EMBEDDING_MANIFEST.model.revision;
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR || resolveBundledCacheDir();
const quantized = parseBoolean(
  process.env.EMBEDDING_LOCAL_QUANTIZED,
  EMBEDDING_MANIFEST.quantization === 'int8'
);
const pooling = process.env.EMBEDDING_LOCAL_POOLING || EMBEDDING_MANIFEST.pooling;
const onnxFile = resolveArtifactPath(
  CACHE_DIR,
  quantized ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx',
  REVISION
);

const result = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  libc: process.report?.getReport?.().header?.glibcVersionRuntime ?? 'n/a',
  quantized,
  pooling,
  cacheDir: CACHE_DIR,
  onnxArtifact: path.basename(onnxFile),
  cacheHitAtStart: fs.existsSync(onnxFile),
  cgroup: readCgroup()
};

const { LocalTransformersProvider } = await import('../../server/embeddings/LocalTransformersProvider.js');
const { default: app } = await import('../../server/app.js');

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;

async function health() {
  const t = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  const body = await response.json();
  return { ms: Date.now() - t, status: response.status, service: body.service, ok: body.status === 'ok' };
}

result.healthBeforeModelLoad = await health();

const rssBeforeMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);

const t0 = Date.now();
const provider = new LocalTransformersProvider({
  model: MODEL,
  revision: REVISION,
  pooling,
  normalize: true,
  quantized,
  cacheDir: CACHE_DIR,
  allowRemoteModels: false,
  strictCache: true
});
const texts = ['warmup', 'How long do I have to return a product for a refund?', 'The company is headquartered in Seattle.'];
const vectors = await provider.embedMany(texts);
const initMs = Date.now() - t0;

const rssAfterLoadMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);

const batchTexts = Array.from({ length: 12 }, (_, i) => `Document number ${i} about refunds, subscriptions, and support.`);
const t1 = Date.now();
await provider.embedMany(batchTexts);
const batchMs = Date.now() - t1;

const rssAfterInferenceMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);

result.healthAfterModelLoad = await health();
await new Promise((r) => setTimeout(r, 250));
result.healthAfterModelLoadDelayed = await health();

const magnitude = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
result.checks = {
  vectorsFinite: vectors.every((v) => v.every(Number.isFinite)),
  vectorsDim384: vectors.every((v) => v.length === 384),
  vectorsL2: vectors.every((v) => Math.abs(magnitude(v) - 1) < 1e-4)
};
result.resources = {
  initMs,
  initKind: result.cacheHitAtStart ? 'warm (artifact already cached)' : 'cold (included download)',
  rssBeforeMb,
  rssAfterLoadMb,
  rssAfterInferenceMb,
  batchCount: batchTexts.length,
  batchMs
};
result.cgroupAfter = readCgroup();

console.log(JSON.stringify(result, null, 2));

server.close();
