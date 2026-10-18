import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import { Pool } from 'pg';
import { toSql } from 'pgvector';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';
import { createChunkService } from '../../server/ingestion/chunkService.js';
import { createEmbeddingService } from '../../server/embeddings/embeddingService.js';
import { createSearchService } from '../../server/search/searchService.js';
import { createRetrievalService } from '../../server/retrieval/retrievalService.js';
import { createGenerationService } from '../../server/generation/generationService.js';
import { buildGenerationPrompt } from '../../server/generation/promptBuilder.js';
import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';
import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { GroqProvider } from '../../server/generation/GroqProvider.js';
import { ProviderError } from '../../server/errors.js';
import { VOYAGE_SPACE_ID, VOYAGE_DIMENSIONS_DEFAULT } from '../../server/embeddings/embeddingSpaces.js';
import { withTransaction } from '../../server/embeddings/embeddingBackfillRunner.js';

const SHADOW_TABLE = 'embedding_shadow_chunks';
const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;
const USER_ID = 'staging-user';

function parseArgs(argv) {
  const args = { databaseUrl: null, useGroq: false, delayMs: 21000 };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];

    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--use-groq': args.useGroq = true; break;
      case '--delay-ms': args.delayMs = Number(next()); break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function l2norm(vector) {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}

function throttle(provider, delayMs) {
  let lastCall = 0;

  async function wait() {
    const delta = lastCall + delayMs - Date.now();

    if (delta > 0) {
      await sleep(delta);
    }

    lastCall = Date.now();
  }

  return {
    dimensions: provider.dimensions,
    async embed(text) {
      await wait();
      return provider.embed(text);
    },
    async embedMany(texts) {
      await wait();
      return provider.embedMany(texts);
    }
  };
}

class ShadowEmbeddingRepository {
  constructor(pool, { space, dimensions }) {
    this.pool = pool;
    this.space = space;
    this.dimensions = dimensions;
  }

  async getChunksForDocument(documentId) {
    const result = await this.pool.query(
      'SELECT id, document_id, chunk_index, content, character_count, created_at FROM chunks WHERE document_id = $1 ORDER BY chunk_index ASC;',
      [documentId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      characterCount: Number(row.character_count),
      createdAt: row.created_at
    }));
  }

  async updateChunkEmbedding(chunkId, embedding) {
    const result = await this.pool.query(
      `
        INSERT INTO ${SHADOW_TABLE} (space_id, document_id, chunk_index, source_chunk_id, dimensions, l2_norm, embedding, updated_at)
        SELECT $1, c.document_id, c.chunk_index, c.id, $3, $4, $2::vector, now()
        FROM chunks c
        WHERE c.id = $5
        ON CONFLICT (space_id, document_id, chunk_index)
        DO UPDATE SET source_chunk_id = EXCLUDED.source_chunk_id,
                      dimensions = EXCLUDED.dimensions,
                      l2_norm = EXCLUDED.l2_norm,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
        RETURNING space_id;
      `,
      [this.space, toSql(embedding), embedding.length, l2norm(embedding), chunkId]
    );

    return result.rows[0] ?? null;
  }

  async countTotalChunks(documentId) {
    const result = await this.pool.query('SELECT COUNT(*)::int AS n FROM chunks WHERE document_id = $1;', [documentId]);
    return Number(result.rows[0]?.n ?? 0);
  }

  async countEmbeddedChunks(documentId) {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM ${SHADOW_TABLE} WHERE space_id = $1 AND document_id = $2;`,
      [this.space, documentId]
    );
    return Number(result.rows[0]?.n ?? 0);
  }
}

class ShadowSearchRepository {
  constructor(pool, { space }) {
    this.pool = pool;
    this.space = space;
  }

  async searchChunksByEmbeddingForUser({ userId, embedding, limit = 10 }) {
    const result = await this.pool.query(
      `
        SELECT s.space_id, c.id, c.document_id, d.file_name, c.chunk_index, c.content,
               1 - (s.embedding <=> $2::vector) AS similarity
        FROM ${SHADOW_TABLE} s
        INNER JOIN chunks c ON c.id = s.source_chunk_id
        INNER JOIN documents d ON d.id = c.document_id
        WHERE s.space_id = $1
          AND d.user_id = $3
        ORDER BY s.embedding <=> $2::vector ASC, c.created_at ASC
        LIMIT $4;
      `,
      [this.space, toSql(embedding), userId, limit]
    );

    return result.rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      fileName: row.file_name,
      chunkIndex: Number(row.chunk_index),
      similarity: Number(row.similarity),
      chunkText: row.content
    }));
  }
}

function makeStubGenerationProvider() {
  return {
    async generate({ messages }) {
      const userMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      return {
        provider: 'stub',
        model: 'stub-echo',
        answerText: `[stub answer] ${userMessage.slice(0, 120).replace(/\s+/g, ' ')}`,
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        finishReason: 'stop'
      };
    }
  };
}

async function insertTextDocument({ documentsRepository, storageDir, fileName, text }) {
  const id = randomUUID();
  const storagePath = path.join(storageDir, `${id}.txt`);
  await writeFile(storagePath, text, 'utf8');

  await documentsRepository.insertDocument({
    id,
    userId: USER_ID,
    fileName,
    fileType: 'txt',
    fileSizeBytes: Buffer.byteLength(text, 'utf8'),
    storagePath,
    extractedText: null,
    sourceType: 'upload',
    status: 'uploaded'
  });

  return { id, storagePath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const target = resolveTarget({ args, env });

  if (!env.VOYAGE_API_KEY) {
    throw new Error('voyage-staging-e2e requires VOYAGE_API_KEY to be set.');
  }

  const space = VOYAGE_SPACE_ID;
  const dimensions = VOYAGE_DIMENSIONS_DEFAULT;
  const pool = new Pool({ connectionString: target.connectionString, ssl: false });
  const storageDir = await mkdtemp(path.join(tmpdir(), 'atlas-staging-e2e-'));

  const report = {
    target: target.safeLabel,
    space,
    dimensions,
    generation: args.useGroq ? 'groq' : 'stub',
    steps: {},
    checks: {}
  };

  try {
    const documentsRepository = new DocumentsRepository(pool);
    const chunkRepository = new ChunkRepository(pool);
    const chunkService = createChunkService({ documentsRepository, chunkRepository });

    const voyageProvider = new VoyageProvider({
      apiKey: env.VOYAGE_API_KEY,
      model: env.VOYAGE_MODEL || 'voyage-4-lite',
      baseUrl: env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1',
      dimensions
    });
    const provider = throttle(voyageProvider, args.delayMs);

    const embeddingService = createEmbeddingService({
      documentsRepository,
      embeddingRepository: new ShadowEmbeddingRepository(pool, { space, dimensions }),
      embeddingProvider: provider,
      dimensions
    });
    const searchService = createSearchService({
      embeddingProvider: provider,
      searchRepository: new ShadowSearchRepository(pool, { space }),
      dimensions
    });
    const retrievalService = createRetrievalService({ searchService });

    const generationProvider = args.useGroq
      ? new GroqProvider({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL })
      : makeStubGenerationProvider();

    const generationService = createGenerationService({
      retrievalService,
      generationProvider,
      buildPrompt: buildGenerationPrompt,
      defaultSimilarityThreshold: 0.3
    });

    const orchestrator = createDocumentOrchestrator({
      documentsRepository,
      chunkService,
      embeddingService,
      ocrService: null,
      runInTransaction: (fn) => withTransaction(pool, fn)
    });

    // 1. Happy path: upload -> extraction -> chunking -> Voyage embedding -> persistence -> ready
    const happyText = 'Atlas Escalation Policy. When a customer issue cannot be resolved by the first-line support team, it is escalated to the dedicated escalation desk. The dedicated escalation email address is escalate@atlas.example, and the on-call engineer acknowledges every escalation within four hours. Escalations that are not acknowledged within four hours are automatically forwarded to the duty manager.';
    const happy = await insertTextDocument({ documentsRepository, storageDir, fileName: 'escalation-policy.txt', text: happyText });
    const happyResult = await orchestrator.processDocument(happy.id);

    report.steps.ingestion = {
      documentId: happy.id,
      status: happyResult?.status,
      progress: happyResult?.progress,
      failureReason: happyResult?.failureReason ?? null
    };

    const { rows: happyChunkRows } = await pool.query('SELECT COUNT(*)::int AS n FROM chunks WHERE document_id = $1;', [happy.id]);
    const { rows: happyShadowRows } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(MIN(dimensions),0)::int AS min_dims, COALESCE(MAX(dimensions),0)::int AS max_dims FROM ${SHADOW_TABLE} WHERE space_id = $1 AND document_id = $2;`,
      [space, happy.id]
    );

    report.steps.persistence = {
      chunks: happyChunkRows[0].n,
      shadowVectors: happyShadowRows[0].n,
      minDimensions: happyShadowRows[0].min_dims,
      maxDimensions: happyShadowRows[0].max_dims
    };

    // 2. Retrieval + generation + citations
    const question = 'What is the dedicated escalation email address?';
    const generation = await generationService.generate(question, { userId: USER_ID });
    report.steps.generation = {
      question,
      answer: generation.answer.slice(0, 200),
      citations: generation.sources.map((s) => ({
        documentId: s.documentId,
        fileName: s.fileName,
        chunkIndex: s.chunkIndex,
        similarity: Number(s.similarity.toFixed(4))
      }))
    };

    // 3. Unanswerable question -> retrieval should not cite the uploaded doc
    const unanswerable = await generationService.generate('What is the capital city of France?', { userId: USER_ID });
    report.steps.unanswerable = {
      question: 'What is the capital city of France?',
      answer: unanswerable.answer.slice(0, 120),
      citationCount: unanswerable.sources.length
    };

    // 4. Failure path: embedding provider fails -> document must be "failed", not stuck
    const failingProvider = {
      dimensions,
      async embed() { throw new ProviderError('Voyage rate limit exceeded.', { provider: 'Voyage', statusCode: 429 }); },
      async embedMany() { throw new ProviderError('You have not yet added your payment method; reduced rate limits of 3 RPM and 10K TPM.', { provider: 'Voyage', statusCode: 429 }); }
    };

    const failingEmbeddingService = createEmbeddingService({
      documentsRepository,
      embeddingRepository: new ShadowEmbeddingRepository(pool, { space, dimensions }),
      embeddingProvider: failingProvider,
      dimensions
    });
    const failingOrchestrator = createDocumentOrchestrator({
      documentsRepository,
      chunkService,
      embeddingService: failingEmbeddingService,
      ocrService: null,
      runInTransaction: (fn) => withTransaction(pool, fn)
    });

    const failing = await insertTextDocument({ documentsRepository, storageDir, fileName: 'failure-case.txt', text: happyText });
    const failingResult = await failingOrchestrator.processDocument(failing.id);

    const { rows: failingStatus } = await pool.query('SELECT status, failure_reason FROM documents WHERE id = $1;', [failing.id]);

    report.steps.failure = {
      documentId: failing.id,
      returnedStatus: failingResult?.status,
      dbStatus: failingStatus[0]?.status,
      failureReason: failingStatus[0]?.failure_reason,
      containsRawProviderBody: /payment method|3 RPM|10K TPM/.test(failingStatus[0]?.failure_reason ?? '')
    };

    // Checks
    report.checks.ingestionReady = happyResult?.status === 'ready';
    report.checks.persistenceDimensions1024 = happyShadowRows[0].n > 0
      && happyShadowRows[0].min_dims === dimensions
      && happyShadowRows[0].max_dims === dimensions;
    report.checks.citationFromUploadedDocument = generation.sources.some((s) => s.documentId === happy.id);
    report.checks.unanswerableNotCited = !unanswerable.sources.some((s) => s.documentId === happy.id);
    report.checks.failureIsFailedNotStuck = failingResult?.status === 'failed'
      && failingStatus[0]?.status === 'failed'
      && !['uploaded', 'extracting', 'chunking', 'embedding', 'ocr'].includes(failingStatus[0]?.status);
    report.checks.failureReasonSanitized = report.steps.failure.containsRawProviderBody === false
      && /rate limit|status 429/i.test(failingStatus[0]?.failure_reason ?? '');

    report.passed = Object.values(report.checks).every(Boolean);

    console.log(JSON.stringify(report, null, 2));
    console.log(report.passed ? 'VOYAGE STAGING E2E: PASS' : 'VOYAGE STAGING E2E: FAIL');

    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`voyage-staging-e2e: ${error.message}`);
  process.exitCode = 1;
});
