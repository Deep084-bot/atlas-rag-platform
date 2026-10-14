/**
 * Development-only harness for measuring and comparing local embedding model
 * variants (fp32 vs quantized int8) using the real LocalTransformersProvider.
 *
 * Does NOT touch any database. Artifacts are cached under EMBEDDING_CACHE_DIR.
 *
 * Usage (separate processes so RSS is not conflated):
 *   MODE=measure VARIANT=fp32  EMBEDDING_CACHE_DIR=... node scripts/dev/local-embedding-variants.mjs
 *   MODE=measure VARIANT=int8  EMBEDDING_CACHE_DIR=... node scripts/dev/local-embedding-variants.mjs
 *   MODE=compare               node scripts/dev/local-embedding-variants.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';

const MODEL = 'Xenova/bge-small-en-v1.5';
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR || path.join(os.tmpdir(), 'atlas-embedding-cache');
const OUT_DIR = process.env.VARIANT_OUT_DIR || path.join(os.tmpdir(), 'atlas-variant-results');

const CORPUS = [
  'The refund policy allows customers to return items within thirty days of purchase.',
  'Subscription plans include free, professional, and enterprise tiers.',
  'The company headquarters is located in Seattle, Washington.',
  'Customer support is available Monday through Friday from eight to eight Pacific Time.',
  'The data centers are distributed across three geographic regions for redundancy.',
  'Annual billing provides a two month discount compared to monthly billing.'
];

const QUERIES = [
  'How long do I have to return something for a refund?',
  'Where is the company based?',
  'What subscription options are offered?'
];

const SINGLE_TEXTS = [
  'What is the capital of France?',
  'PostgreSQL uses MVCC for concurrency control.',
  'Retrieval augmented generation combines search with an LLM.'
];

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

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function rankByCosine(queryVec, docs) {
  return docs
    .map((vec, index) => ({ index, score: cosine(queryVec, vec) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fingerprintCache(dir) {
  const modelDir = path.join(dir, MODEL);
  const files = [];
  if (fs.existsSync(modelDir)) {
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push({
          name: path.relative(modelDir, full),
          bytes: fs.statSync(full).size,
          sha256: /\.onnx$/.test(entry.name) ? sha256(full) : undefined
        });
      }
    };
    walk(modelDir);
  }
  return { modelDir, files };
}

function onnxArtifactExists(quantized) {
  const file = path.join(CACHE_DIR, MODEL, 'onnx', quantized ? 'model_quantized.onnx' : 'model.onnx');
  return fs.existsSync(file);
}

function round(vector, digits = 6) {
  const f = 10 ** digits;
  return vector.map((v) => Math.round(v * f) / f);
}

async function measure(variant) {
  const quantized = variant === 'int8';
  const cacheHit = onnxArtifactExists(quantized);

  const rssBeforeMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const t0 = Date.now();

  const provider = new LocalTransformersProvider({
    model: MODEL,
    pooling: 'mean',
    normalize: true,
    quantized,
    cacheDir: CACHE_DIR
  });

  await provider.embedMany(['warmup']);

  const initMs = Date.now() - t0;
  const rssAfterLoadMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);

  const result = {
    variant,
    quantized,
    pooling: provider.pooling,
    normalize: provider.normalize,
    model: provider.model,
    cacheHit,
    resources: { initMs, initKind: cacheHit ? 'warm (artifact already cached)' : 'cold (included download)', rssBeforeMb, rssAfterLoadMb },
    single: [],
    batch: null,
    embeddings: {},
    cache: fingerprintCache(CACHE_DIR)
  };

  for (const text of SINGLE_TEXTS) {
    const t = Date.now();
    const vec = await provider.embed(text);
    const ms = Date.now() - t;
    const mag = magnitude(vec);
    result.single.push({
      text: text.slice(0, 40),
      ms,
      dims: vec.length,
      finite: vec.every(Number.isFinite),
      l2Magnitude: +mag.toFixed(6),
      l2Normalized: Math.abs(mag - 1) < 1e-4
    });
  }

  const batchTexts = [...SINGLE_TEXTS, ...CORPUS];
  const tBatch = Date.now();
  const batchVecs = await provider.embedMany(batchTexts);
  const batchMs = Date.now() - tBatch;
  result.batch = {
    count: batchVecs.length,
    totalMs: batchMs,
    perItemMs: +(batchMs / batchVecs.length).toFixed(1),
    allFinite: batchVecs.every((v) => v.every(Number.isFinite)),
    all384: batchVecs.every((v) => v.length === 384),
    allL2: batchVecs.every((v) => Math.abs(magnitude(v) - 1) < 1e-4)
  };

  const corpusVecs = await provider.embedMany(CORPUS);
  const queryVecs = await provider.embedMany(QUERIES);

  result.embeddings.single = (await Promise.all(SINGLE_TEXTS.map((t) => provider.embed(t)))).map((v) => round(v));
  result.embeddings.corpus = corpusVecs.map((v) => round(v));
  result.embeddings.queries = queryVecs.map((v) => round(v));
  result.rankings = QUERIES.map((q, i) => ({ query: q, order: rankByCosine(queryVecs[i], corpusVecs) }));

  const rssAfterInferenceMb = +(process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  result.resources.rssAfterInferenceMb = rssAfterInferenceMb;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${variant}.json`), JSON.stringify(result));

  console.log(JSON.stringify(result, null, 2));
}

function compare() {
  const fp32 = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'fp32.json'), 'utf8'));
  const int8 = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'int8.json'), 'utf8'));

  const perText = fp32.embeddings.single.map((vec, i) => {
    const other = int8.embeddings.single[i];
    const perDim = vec.map((v, d) => Math.abs(v - other[d]));
    return {
      text: SINGLE_TEXTS[i].slice(0, 40),
      cosine: +cosine(vec, other).toFixed(6),
      maxAbsDiff: +Math.max(...perDim).toFixed(6),
      meanAbsDiff: +(perDim.reduce((s, x) => s + x, 0) / perDim.length).toFixed(6)
    };
  });

  const rankingDiff = fp32.rankings.map((entry, i) => {
    const other = int8.rankings[i];
    const sameOrder = JSON.stringify(entry.order) === JSON.stringify(other.order);
    return {
      query: entry.query,
      fp32Order: entry.order,
      int8Order: other.order,
      sameOrder,
      top1Same: entry.order[0] === other.order[0]
    };
  });

  const corpusCosines = fp32.embeddings.corpus.map((vec, i) => +cosine(vec, int8.embeddings.corpus[i]).toFixed(6));

  const summary = {
    perTextCosine: {
      min: +Math.min(...perText.map((p) => p.cosine)).toFixed(6),
      max: +Math.max(...perText.map((p) => p.cosine)).toFixed(6),
      mean: +(perText.reduce((s, p) => s + p.cosine, 0) / perText.length).toFixed(6)
    },
    corpusCosine: {
      min: +Math.min(...corpusCosines).toFixed(6),
      max: +Math.max(...corpusCosines).toFixed(6),
      mean: +(corpusCosines.reduce((s, c) => s + c, 0) / corpusCosines.length).toFixed(6)
    },
    allRankingsSame: rankingDiff.every((r) => r.sameOrder),
    allTop1Same: rankingDiff.every((r) => r.top1Same),
    artifacts: { fp32: fp32.cache.files, int8: int8.cache.files },
    resources: { fp32: fp32.resources, int8: int8.resources }
  };

  console.log(JSON.stringify({ perText, rankingDiff, corpusCosines, summary }, null, 2));
}

const mode = process.env.MODE || 'measure';

if (mode === 'compare') {
  compare();
} else {
  const variant = process.env.VARIANT;
  if (variant !== 'fp32' && variant !== 'int8') {
    throw new Error('VARIANT must be fp32 or int8 for MODE=measure');
  }
  measure(variant).catch((error) => {
    console.error('VARIANT MEASURE FAILED:');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
