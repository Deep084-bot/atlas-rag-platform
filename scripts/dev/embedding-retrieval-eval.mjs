import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { Pool } from 'pg';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { assertRuntimeConfigMatchesManifest } from '../../server/embeddings/embeddingManifest.js';
import {
  BGE_SPACE_ID,
  VOYAGE_MODEL_DEFAULT,
  getEmbeddingSpace,
  resolveEmbeddingSpaceForProvider,
  voyageSpaceId
} from '../../server/embeddings/embeddingSpaces.js';
import {
  DEFAULT_K,
  hitAtK,
  ndcgAtK,
  noAnswerSummary,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  round,
  toRelevanceMap,
  topSimilarity
} from './lib/retrieval-metrics.mjs';
import { estimateEvaluationUsage } from './lib/token-estimate.mjs';

const SHADOW_TABLE = 'embedding_shadow_chunks';
const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;
const BASELINE_SOURCE = 'baseline';

function parseArgs(argv) {
  const args = {
    databaseUrl: null,
    space: null,
    provider: 'local',
    dimensions: null,
    source: BASELINE_SOURCE,
    cases: null,
    topK: 5,
    delayMs: 0,
    minRecall: 1,
    noAnswerThreshold: null,
    queryCache: null,
    documents: null,
    plan: false,
    out: null,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];

    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--space': args.space = next(); break;
      case '--provider': args.provider = next(); break;
      case '--dimensions': args.dimensions = next(); break;
      case '--source': args.source = next(); break;
      case '--cases': args.cases = next(); break;
      case '--top-k': args.topK = next(); break;
      case '--delay-ms': args.delayMs = next(); break;
      case '--min-recall': args.minRecall = next(); break;
      case '--query-cache': args.queryCache = next(); break;
      case '--documents': args.documents = next(); break;
      case '--no-answer-threshold': args.noAnswerThreshold = next(); break;
      case '--plan': args.plan = true; break;
      case '--out': args.out = next(); break;
      case '--json': args.json = true; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  args.dimensions = args.dimensions === null ? null : Number(args.dimensions);
  args.topK = Number(args.topK);
  args.delayMs = Number(args.delayMs) || 0;
  args.minRecall = Number(args.minRecall);
  args.noAnswerThreshold = args.noAnswerThreshold === null ? null : Number(args.noAnswerThreshold);

  if (args.documents !== null) {
    const list = String(args.documents)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (list.length === 0) {
      throw new Error('--documents requires at least one document id.');
    }

    args.documents = list;
  }

  if (!Number.isFinite(args.minRecall) || args.minRecall < 0 || args.minRecall > 1) {
    throw new Error(`Invalid --min-recall "${args.minRecall}".`);
  }

  if (!args.cases) {
    throw new Error('Missing required --cases <path>.');
  }

  if (args.plan) {
    // Plan mode performs no database or network access.
    if (!Number.isInteger(args.topK) || args.topK <= 0) {
      throw new Error(`Invalid --top-k "${args.topK}".`);
    }
    return args;
  }

  if (args.dimensions !== null && (!Number.isFinite(args.dimensions) || args.dimensions <= 0)) {
    throw new Error(`Invalid --dimensions "${args.dimensions}".`);
  }

  if (!['baseline', 'shadow'].includes(args.source)) {
    throw new Error(`Invalid --source "${args.source}".`);
  }

  if (args.queryCache !== null && typeof args.queryCache !== 'string') {
    throw new Error('--query-cache requires a file path.');
  }

  if (args.noAnswerThreshold !== null && !Number.isFinite(args.noAnswerThreshold)) {
    throw new Error(`Invalid --no-answer-threshold "${args.noAnswerThreshold}".`);
  }

  return args;
}

function resolveTarget({ args, env }) {
  const raw = args.databaseUrl || env.MIGRATION_DATABASE_URL;

  if (!raw) {
    throw new Error('No target database provided. Pass --database-url or set MIGRATION_DATABASE_URL. This tool never falls back to DATABASE_URL.');
  }

  if (env.DATABASE_URL && raw === env.DATABASE_URL) {
    throw new Error('Refusing to run: target URL is identical to DATABASE_URL (production).');
  }

  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!SAFE_DB_PATTERN.test(database)) {
    throw new Error(`Refusing to run: database name "${database}" does not look like a staging/disposable target.`);
  }

  return { connectionString: raw, safeLabel: `${parsed.hostname}:${parsed.port || '5432'}/${database}` };
}

function toSqlVector(vector) {
  return `[${vector.join(',')}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSpaceSelection({ args, env }) {
  const providerName = (args.provider || 'local').trim().toLowerCase();

  if (!['local', 'voyage'].includes(providerName)) {
    throw new Error(`Unsupported --provider "${providerName}". Supported: local, voyage.`);
  }

  const baseSpace = resolveEmbeddingSpaceForProvider(providerName, env);
  const dimensions = Number.isFinite(args.dimensions) && args.dimensions > 0 ? args.dimensions : baseSpace.dimensions;
  let spaceId;
  if (args.space) {
    spaceId = args.space;
  } else if (baseSpace.kind === 'voyage') {
    spaceId = voyageSpaceId(dimensions);
  } else {
    spaceId = baseSpace.id;
  }

  return {
    providerName,
    space: spaceId,
    dimensions,
    spaceConfig: getEmbeddingSpace(spaceId) ?? { ...baseSpace, id: spaceId, dimensions, derived: true }
  };
}

function buildProvider({ providerName, dimensions, spaceConfig, env }) {
  if (providerName === 'voyage') {
    if (!env.VOYAGE_API_KEY) {
      throw new Error('--provider voyage requires VOYAGE_API_KEY to be set.');
    }

    return new VoyageProvider({
      apiKey: env.VOYAGE_API_KEY,
      model: env.VOYAGE_MODEL || VOYAGE_MODEL_DEFAULT,
      baseUrl: env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1',
      dimensions,
      normalize: true
    });
  }

  assertRuntimeConfigMatchesManifest(env);
  return createEmbeddingProvider({ providerName: 'local' });
}

async function queryBaseline(pool, { vector, topK, documentIds = null }) {
  const filter = Array.isArray(documentIds) && documentIds.length > 0
    ? 'AND chunks.document_id = ANY($3::uuid[])'
    : '';
  const params = [toSqlVector(vector), topK];
  if (filter) params.push(documentIds);

  const { rows } = await pool.query(
    `
      SELECT chunks.document_id, chunks.chunk_index, chunks.content,
             1 - (chunks.embedding <=> $1::vector) AS similarity
      FROM chunks
      WHERE chunks.embedding IS NOT NULL ${filter}
      ORDER BY chunks.embedding <=> $1::vector
      LIMIT $2;
    `,
    params
  );

  return rows.map((r) => ({
    documentId: r.document_id,
    chunkIndex: Number(r.chunk_index),
    similarity: Number(r.similarity),
    head: String(r.content).slice(0, 60).replace(/\s+/g, ' '),
    spaceId: BGE_SPACE_ID
  }));
}

async function queryShadow(pool, { space, vector, topK, documentIds = null }) {
  const filter = Array.isArray(documentIds) && documentIds.length > 0
    ? 'AND s.document_id = ANY($4::uuid[])'
    : '';
  const params = [space, toSqlVector(vector), topK];
  if (filter) params.push(documentIds);

  const { rows } = await pool.query(
    `
      SELECT s.space_id, s.document_id, s.chunk_index, c.content,
             1 - (s.embedding <=> $2::vector) AS similarity
      FROM ${SHADOW_TABLE} s
      JOIN chunks c ON c.id = s.source_chunk_id
      WHERE s.space_id = $1 ${filter}
      ORDER BY s.embedding <=> $2::vector
      LIMIT $3;
    `,
    params
  );

  return rows.map((r) => ({
    documentId: r.document_id,
    chunkIndex: Number(r.chunk_index),
    similarity: Number(r.similarity),
    head: String(r.content).slice(0, 60).replace(/\s+/g, ' '),
    spaceId: r.space_id
  }));
}

function evaluateCase(testCase, results, { topK, noAnswerThreshold, minRecall }) {
  if (testCase.expectNoAnswer) {
    const similarity = topSimilarity(results);
    const threshold = Number.isFinite(noAnswerThreshold)
      ? noAnswerThreshold
      : (Number.isFinite(testCase.maxSimilarity) ? testCase.maxSimilarity : null);

    return {
      type: 'no-answer',
      topSimilarity: round(similarity),
      threshold,
      passed: threshold === null ? null : similarity < threshold
    };
  }

  const relevanceMap = toRelevanceMap(testCase);
  const recall = recallAtK(results, relevanceMap, topK);
  const ndcg = ndcgAtK(results, relevanceMap, topK);

  return {
    type: 'recall',
    relevantCount: relevanceMap.size,
    recallAtK: round(recall),
    precisionAtK: round(precisionAtK(results, relevanceMap, topK)),
    mrr: round(reciprocalRank(results, relevanceMap)),
    ndcgAtK: round(ndcgAtK(results, relevanceMap, topK)),
    hitAtK: hitAtK(results, relevanceMap, topK),
    passed: recall !== null && recall >= minRecall
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const cases = JSON.parse(await readFile(args.cases, 'utf8'));

  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('--cases file must contain a non-empty JSON array.');
  }

  if (args.plan) {
    const estimatedUsage = estimateEvaluationUsage({ cases, includeCorpusReEmbed: false });

    console.log(JSON.stringify({
      mode: 'plan',
      cases: cases.length,
      estimatedUsage,
      note: 'Plan mode: no database or network access performed.'
    }, null, 2));
    console.log('RETRIEVAL EVAL PLAN: OK');
    return;
  }

  const target = resolveTarget({ args, env });
  const selection = resolveSpaceSelection({ args, env });
  const queryCache = args.queryCache ? JSON.parse(await readFile(args.queryCache, 'utf8')) : null;

  const provider = buildProvider({ providerName: selection.providerName, dimensions: selection.dimensions, spaceConfig: selection.spaceConfig, env });
  const pool = new Pool({ connectionString: target.connectionString, ssl: false });

  const summary = {
    target: target.safeLabel,
    source: args.source,
    space: selection.space,
    spaceConfig: {
      id: selection.spaceConfig.id,
      kind: selection.spaceConfig.kind,
      model: selection.spaceConfig.model,
      dimensions: selection.spaceConfig.dimensions,
      normalization: selection.spaceConfig.normalization
    },
    topK: args.topK,
    documentFilter: Array.isArray(args.documents) ? args.documents : null,
    cases: []
  };

  try {
    let cachedVectors = 0;

    for (const testCase of cases) {
      const cachedVector = queryCache && Array.isArray(queryCache[testCase.id]) ? queryCache[testCase.id] : null;
      const vector = cachedVector ?? await provider.embed(testCase.query);

      if (cachedVector) {
        cachedVectors += 1;
      }

      if (vector.length !== selection.dimensions) {
        throw new Error(`Provider returned ${vector.length}-dim query vector, expected ${selection.dimensions} (space ${selection.space}).`);
      }

      const results = args.source === 'baseline'
        ? await queryBaseline(pool, { vector, topK: args.topK, documentIds: args.documents })
        : await queryShadow(pool, { space: selection.space, vector, topK: args.topK, documentIds: args.documents });

      if (args.delayMs > 0) {
        await sleep(args.delayMs);
      }

      const evaluation = evaluateCase(testCase, results, { topK: args.topK, noAnswerThreshold: args.noAnswerThreshold, minRecall: args.minRecall });
      const returnedSpaces = [...new Set(results.map((r) => r.spaceId))];

      summary.cases.push({
        id: testCase.id ?? null,
        kind: testCase.kind ?? null,
        query: testCase.query,
        cachedQueryVector: Boolean(cachedVector),
        expected: testCase.expectNoAnswer
          ? { noAnswer: true, threshold: evaluation.threshold }
          : {
            relevance: testCase.relevance ?? null,
            documentIds: testCase.expectedDocumentIds ?? (testCase.expectedDocumentId ? [testCase.expectedDocumentId] : []),
            chunkIndices: testCase.expectedChunkIndices ?? []
          },
        top: results.map((r) => ({ documentId: r.documentId, chunkIndex: r.chunkIndex, similarity: Number(r.similarity.toFixed(4)), head: r.head })),
        returnedSpaces,
        ...evaluation
      });
    }

    const recallCases = summary.cases.filter((c) => c.type === 'recall');
    const noAnswerCases = summary.cases.filter((c) => c.type === 'no-answer');
    const answerableTop1 = recallCases.map((c) => c.top[0]?.similarity ?? 0);
    const noAnswerTop1 = noAnswerCases.map((c) => c.topSimilarity);

    // No-answer queries are judged by separability from answerable queries for THIS model,
    // because absolute cosine thresholds are not comparable across embedding models.
    const noAnswer = noAnswerSummary({ noAnswerTop1, answerableTop1, threshold: args.noAnswerThreshold });

    for (const entry of noAnswerCases) {
      entry.separated = noAnswer.separated;
      entry.minAnswerableTop1 = noAnswer.minAnswerable;
      entry.passed = noAnswer.separated;
    }

    const macro = (values) => {
      const numeric = values.filter((value) => Number.isFinite(value));
      return numeric.length > 0
        ? Number((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(4))
        : null;
    };

    const perKind = {};
    for (const entry of summary.cases) {
      const kind = entry.kind ?? 'unlabelled';
      perKind[kind] ??= { count: 0, passed: 0, recallAtK: [], ndcgAtK: [], mrr: [] };
      perKind[kind].count += 1;
      if (entry.passed) {
        perKind[kind].passed += 1;
      }
      if (entry.type === 'recall') {
        perKind[kind].recallAtK.push(entry.recallAtK);
        perKind[kind].ndcgAtK.push(entry.ndcgAtK);
        perKind[kind].mrr.push(entry.mrr);
      }
    }

    const perKindMetrics = {};
    for (const [kind, aggregate] of Object.entries(perKind)) {
      perKindMetrics[kind] = {
        count: aggregate.count,
        passed: aggregate.passed,
        recallAtK: macro(aggregate.recallAtK),
        ndcgAtK: macro(aggregate.ndcgAtK),
        mrr: macro(aggregate.mrr)
      };
    }

    summary.metrics = {
      cases: summary.cases.length,
      recallCases: recallCases.length,
      noAnswerCases: noAnswerCases.length,
      cachedQueryVectors: cachedVectors,
      recallAtK: macro(recallCases.map((c) => c.recallAtK)),
      precisionAtK: macro(recallCases.map((c) => c.precisionAtK)),
      mrr: macro(recallCases.map((c) => c.mrr)),
      ndcgAtK: macro(recallCases.map((c) => c.ndcgAtK)),
      hitRateAtK: recallCases.length > 0 ? macro(recallCases.map((c) => (c.hitAtK ? 1 : 0))) : null,
      answerableTop1Min: noAnswer.minAnswerable,
      answerableTop1Max: answerableTop1.length > 0 ? round(Math.max(...answerableTop1)) : null,
      noAnswerTop1: noAnswerTop1[0] ?? null,
      noAnswerTop1Max: noAnswer.maxNoAnswer,
      noAnswerSeparated: noAnswer.separated,
      noAnswerMargin: noAnswer.margin,
      noAnswerFalsePositiveRate: noAnswer.falsePositiveRate,
      perKind: perKindMetrics,
      failures: summary.cases.filter((c) => c.passed === false).map((c) => c.id ?? c.query)
    };
    summary.allSingleSpace = summary.cases.every((c) => c.returnedSpaces.length <= 1);
    summary.passed = summary.metrics.failures.length === 0 && summary.allSingleSpace;

    if (args.out) {
      await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    }

    console.log(JSON.stringify(summary, null, 2));
    console.log(summary.passed ? 'RETRIEVAL EVAL: PASS' : 'RETRIEVAL EVAL: FAIL');

    if (!summary.passed) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`embedding-retrieval-eval: ${error.message}`);
  process.exitCode = 1;
});
