import { readFileSync } from 'node:fs';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import {
  EMBEDDING_MANIFEST,
  EMBEDDING_SPACE_ID,
  assertRuntimeConfigMatchesManifest,
  runtimeConfigFromEnv
} from '../../server/embeddings/embeddingManifest.js';

function parseArgs(argv) {
  const args = { concurrency: 1, iterations: 1, checkManifest: false, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    switch (token) {
      case '--concurrency':
        args.concurrency = Number(argv[i + 1]);
        i += 1;
        break;
      case '--iterations':
        args.iterations = Number(argv[i + 1]);
        i += 1;
        break;
      case '--check-manifest':
        args.checkManifest = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

const SAMPLE_TEXTS = [
  'Our refund policy allows returns within thirty days of purchase.',
  'Shipping is free for orders over fifty dollars.',
  'Contact support by email for account issues.'
];

function cgroupMemoryBytes() {
  for (const candidate of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try {
      return Number(readFileSync(candidate, 'utf8').trim());
    } catch {
      continue;
    }
  }
  return null;
}

function l2norm(vector) {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = runtimeConfigFromEnv();
  const summary = {
    spaceId: EMBEDDING_SPACE_ID,
    manifestRevision: EMBEDDING_MANIFEST.model.revision,
    runtime: {
      model: config.model,
      revision: config.revision ?? null,
      pooling: config.pooling,
      quantized: config.quantized,
      normalize: config.normalize,
      dimensions: config.dimensions,
      cacheDir: config.cacheDir ?? null,
      allowRemoteModels: config.allowRemoteModels
    },
    node: process.version,
    platform: `${process.platform}/${process.arch}`
  };

  if (args.checkManifest) {
    assertRuntimeConfigMatchesManifest();
    summary.manifestMatch = true;
  }

  const rssBefore = process.memoryUsage().rss;
  const provider = createEmbeddingProvider({ providerName: 'local' });

  let peakRss = rssBefore;
  let peakCgroup = cgroupMemoryBytes();

  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) {
      peakRss = rss;
    }
    const cg = cgroupMemoryBytes();
    if (cg !== null && (peakCgroup === null || cg > peakCgroup)) {
      peakCgroup = cg;
    }
  }, 20);

  let initMs = 0;
  let first = null;
  let batches = [];
  let parallelCalls = 0;
  let concurrencyMs = 0;

  try {
    const initStartedAt = Date.now();
    first = await provider.embed(SAMPLE_TEXTS[0]);
    initMs = Date.now() - initStartedAt;

    const runs = [];

    for (let i = 0; i < args.iterations; i += 1) {
      for (let j = 0; j < args.concurrency; j += 1) {
        runs.push(provider.embedMany(SAMPLE_TEXTS));
      }
    }

    parallelCalls = runs.length;
    const concurrencyStartedAt = Date.now();
    batches = await Promise.all(runs);
    concurrencyMs = Date.now() - concurrencyStartedAt;
  } finally {
    clearInterval(sampler);
  }

  summary.firstEmbed = {
    initMs,
    dimensions: first.length,
    allFinite: first.every((v) => Number.isFinite(v)),
    l2norm: Number(l2norm(first).toFixed(6))
  };

  const allVectors = batches.flat();
  summary.concurrency = {
    parallelCalls,
    batches: batches.length,
    vectors: allVectors.length,
    totalMs: concurrencyMs,
    perBatchMs: batches.length ? Number((concurrencyMs / batches.length).toFixed(2)) : 0,
    allDims384: allVectors.every((v) => v.length === EMBEDDING_MANIFEST.dimensions),
    allFinite: allVectors.every((v) => v.every((x) => Number.isFinite(x))),
    maxNormDeviation: allVectors.length ? Number(Math.max(...allVectors.map((v) => Math.abs(l2norm(v) - 1))).toFixed(6)) : 1
  };

  const rssAfter = process.memoryUsage().rss;
  const cgroupAfter = cgroupMemoryBytes();
  summary.memory = {
    rssBeforeMB: Number((rssBefore / 1048576).toFixed(1)),
    rssAfterMB: Number((rssAfter / 1048576).toFixed(1)),
    peakRssMB: Number((peakRss / 1048576).toFixed(1)),
    peakCgroupMB: peakCgroup === null ? null : Number((peakCgroup / 1048576).toFixed(1)),
    cgroupAfterMB: cgroupAfter === null ? null : Number((cgroupAfter / 1048576).toFixed(1))
  };

  summary.passed = summary.firstEmbed.dimensions === EMBEDDING_MANIFEST.dimensions
    && summary.firstEmbed.allFinite
    && Math.abs(summary.firstEmbed.l2norm - 1) < 1e-3
    && summary.concurrency.allDims384
    && summary.concurrency.allFinite
    && summary.concurrency.maxNormDeviation < 1e-3;

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }

  console.log(summary.passed ? 'RUNTIME RESULT: PASS' : 'RUNTIME RESULT: FAIL');

  if (!summary.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`embedding-runtime-check: ${error.message}`);
  process.exitCode = 1;
});
