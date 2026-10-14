/**
 * Development-only smoke test for real local embedding inference.
 *
 * Downloads the ONNX model on first run (acceptable for this explicit test).
 * Does NOT touch any database. Run with:
 *   node scripts/dev/local-embedding-smoke.mjs
 *
 * Optional env:
 *   EMBEDDING_CACHE_DIR   where model artifacts are cached (default: OS temp dir)
 *   SMOKE_QUANTIZED       "true" to also exercise the quantized weights
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';

const MODEL = 'Xenova/bge-small-en-v1.5';
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR || path.join(os.tmpdir(), 'atlas-embedding-cache');

const SHORT_TEXTS = [
  'What is the capital of France?',
  'PostgreSQL uses MVCC for concurrency control.',
  'Retrieval augmented generation combines search with an LLM.'
];

const LONG_TEXT = `Atlas is a retrieval augmented generation platform. ${'It ingests documents, splits them into chunks, embeds each chunk, and stores the vectors in PostgreSQL using the pgvector extension. '.repeat(40)}`;

function cosine(a, b) {
  let dot = 0;
  let ma = 0;
  let mb = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }

  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? Number.NaN : dot / denom;
}

function maxAbsDiff(a, b) {
  let max = 0;

  for (let i = 0; i < a.length; i += 1) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }

  return max;
}

function l2Normalize(vector) {
  const mag = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  return vector.map((value) => value / mag);
}

function meanOverAllTokens(tensor) {
  const [, seq, dim] = tensor.dims;
  const totals = new Array(dim).fill(0);

  for (let token = 0; token < seq; token += 1) {
    for (let d = 0; d < dim; d += 1) {
      totals[d] += tensor.data[token * dim + d];
    }
  }

  return totals.map((value) => value / seq);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fingerprintCache(dir) {
  const modelDir = path.join(dir, MODEL);

  if (!fs.existsSync(modelDir)) {
    return { modelDir, files: [] };
  }

  const files = [];

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const stats = fs.statSync(full);
        files.push({
          name: path.relative(modelDir, full),
          bytes: stats.size,
          sha256: /\.onnx$/.test(entry.name) ? sha256(full) : undefined
        });
      }
    }
  };

  walk(modelDir);
  return { modelDir, files };
}

async function main() {
  const results = { model: MODEL, cacheDir: CACHE_DIR, library: {}, inference: [], pooling: [], determinism: [], ordering: [], resources: {} };

  const rssBefore = process.memoryUsage().rss;
  const tInit0 = Date.now();

  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir = CACHE_DIR;
  env.allowRemoteModels = true;

  results.library.version = env.version;
  results.library.defaultQuantized = true;

  const extractor = await pipeline('feature-extraction', MODEL, { quantized: false });
  const initMs = Date.now() - tInit0;
  const rssAfterLoad = process.memoryUsage().rss;

  results.resources.initMs = initMs;
  results.resources.rssBeforeMb = +(rssBefore / 1024 / 1024).toFixed(1);
  results.resources.rssAfterLoadMb = +(rssAfterLoad / 1024 / 1024).toFixed(1);
  results.library.modelMaxLength = extractor.tokenizer?.model_max_length ?? null;

  // Wrap the already-loaded extractor so both pooling modes reuse one ONNX session.
  const makeProvider = (pooling) =>
    new LocalTransformersProvider({
      pooling,
      normalize: true,
      loadExtractor: async () => extractor
    });

  const providerMean = makeProvider('mean');
  const providerCls = makeProvider('cls');

  const allTexts = [...SHORT_TEXTS, LONG_TEXT];
  const hostedProcedure = [];

  for (const text of allTexts) {
    const tokenIds = extractor.tokenizer(text).input_ids;
    const tokenDims = tokenIds.dims ?? [];
    const tokenCount = tokenDims.length ? tokenDims[tokenDims.length - 1] : tokenIds.length;

    const t0 = Date.now();
    const meanVec = await providerMean.embed(text);
    const meanMs = Date.now() - t0;

    const t1 = Date.now();
    const clsVec = await providerCls.embed(text);
    const clsMs = Date.now() - t1;

    // Reproduce the hosted HuggingFaceProvider procedure: raw token embeddings ->
    // average over every returned token row -> L2 normalize.
    const raw = await extractor([text], { pooling: 'none', normalize: false });
    const hostedVec = l2Normalize(meanOverAllTokens(raw));
    hostedProcedure.push(hostedVec);

    results.inference.push({
      chars: text.length,
      tokens: tokenCount,
      meanMs,
      clsMs,
      finite: meanVec.every(Number.isFinite) && clsVec.every(Number.isFinite),
      dims: [meanVec.length, clsVec.length]
    });

    results.pooling.push({
      tokens: tokenCount,
      cosineMeanVsHostedRepro: +cosine(meanVec, hostedVec).toFixed(6),
      cosineClsVsHostedRepro: +cosine(clsVec, hostedVec).toFixed(6),
      cosineMeanVsCls: +cosine(meanVec, clsVec).toFixed(6),
      meanMag: +Math.sqrt(meanVec.reduce((s, v) => s + v * v, 0)).toFixed(6),
      clsMag: +Math.sqrt(clsVec.reduce((s, v) => s + v * v, 0)).toFixed(6)
    });
  }

  // Determinism: same input twice.
  const a1 = await providerMean.embed(SHORT_TEXTS[0]);
  const a2 = await providerMean.embed(SHORT_TEXTS[0]);
  results.determinism.push({ label: 'mean-same-input', maxAbsDiff: maxAbsDiff(a1, a2) });

  // Batch ordering: batch result must equal per-item results.
  const batch = await providerMean.embedMany(SHORT_TEXTS);
  const perItem = [];
  for (const text of SHORT_TEXTS) {
    perItem.push(await providerMean.embed(text));
  }
  const orderDiffs = batch.map((vec, i) => maxAbsDiff(vec, perItem[i]));
  results.ordering.push({ batchSize: batch.length, maxAbsDiffPerIndex: orderDiffs });

  const rssAfterInference = process.memoryUsage().rss;
  results.resources.rssAfterInferenceMb = +(rssAfterInference / 1024 / 1024).toFixed(1);

  results.cache = fingerprintCache(CACHE_DIR);

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error('SMOKE TEST FAILED:');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
