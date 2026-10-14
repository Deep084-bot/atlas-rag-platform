import { readFile, stat } from 'node:fs/promises';
import { readFileSync as readFileSyncNode } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { SearchRepository } from '../../server/search/searchRepository.js';
import { createChunkService } from '../../server/ingestion/chunkService.js';
import { createEmbeddingService } from '../../server/embeddings/embeddingService.js';
import { createSearchService } from '../../server/search/searchService.js';
import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';
import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { extractTextFromUpload } from '../../server/documents/extractText.js';

const DB_URL = process.env.STAGE21_DB_URL || 'postgresql://localhost:5432/atlas_stage21_test';
const PDF_PATH = process.env.STAGE21_PDF;
const TXT_PATH = process.env.STAGE21_SRC;
const USER_ID = 'stage21-e2e-user';
const QUERY = 'How many days do I have to return a product to get a refund?';

if (!/atlas_stage21_test/.test(DB_URL)) {
  throw new Error(`Refusing to run: STAGE21_DB_URL must point at the disposable test DB, got "${DB_URL}".`);
}
if (!PDF_PATH || !TXT_PATH) {
  throw new Error('STAGE21_PDF and STAGE21_SRC must both be set.');
}

const summary = {};

const pool = new Pool({ connectionString: DB_URL, ssl: false });

async function countRows() {
  const docs = await pool.query('SELECT COUNT(*)::int AS n FROM documents');
  const chunks = await pool.query('SELECT COUNT(*)::int AS n FROM chunks');
  const embedded = await pool.query('SELECT COUNT(*)::int AS n FROM chunks WHERE embedding IS NOT NULL');
  return { documents: docs.rows[0].n, chunks: chunks.rows[0].n, embeddedChunks: embedded.rows[0].n };
}

async function probePdfExtraction() {
  const bufferSync = readFileSyncNode(PDF_PATH);
  const bufferAsync = await readFile(PDF_PATH);
  const result = {};
  try {
    const r = await extractTextFromUpload({ buffer: bufferSync, mimeType: 'application/pdf', originalName: 'sample.pdf' });
    result.syncBuffer = { ok: true, length: r.extractedText.length, hasThirtyDays: r.extractedText.includes('thirty days') };
  } catch (error) {
    result.syncBuffer = { ok: false, error: error.message };
  }
  try {
    const r = await extractTextFromUpload({ buffer: bufferAsync, mimeType: 'application/pdf', originalName: 'sample.pdf' });
    result.asyncBuffer = { ok: true, length: r.extractedText.length, hasThirtyDays: r.extractedText.includes('thirty days') };
  } catch (error) {
    result.asyncBuffer = { ok: false, error: error.message };
  }
  return result;
}

try {
  summary.pdfExtractionProbe = await probePdfExtraction();

  const txtBuffer = await readFile(TXT_PATH);
  const txtSize = (await stat(TXT_PATH)).size;
  const documentId = randomUUID();

  const documentsRepository = new DocumentsRepository(pool);
  const chunkRepository = new ChunkRepository(pool);
  const embeddingRepository = new EmbeddingRepository(pool);
  const searchRepository = new SearchRepository(pool);

  await documentsRepository.insertDocument({
    id: documentId,
    userId: USER_ID,
    fileName: 'policy-sample.txt',
    fileType: 'txt',
    fileSizeBytes: txtSize,
    storagePath: TXT_PATH,
    extractedText: '',
    sourceType: 'upload',
    status: 'uploaded',
    progress: 0
  });

  const chunkService = createChunkService({ documentsRepository, chunkRepository });
  const provider = createEmbeddingProvider({ providerName: 'local' });
  const embeddingService = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    embeddingProvider: provider,
    batchSize: 8
  });

  summary.provider = { name: provider.constructor.name, pooling: provider.pooling, quantized: provider.quantized, model: provider.model, dimensions: provider.dimensions };

  const ocrService = {
    async ocrPdf() {
      throw new Error('OCR invoked unexpectedly for a text source.');
    }
  };

  const orchestrator = createDocumentOrchestrator({ documentsRepository, chunkService, embeddingService, ocrService });

  const startedAt = Date.now();
  const result = await orchestrator.processDocument(documentId);
  const ingestionMs = Date.now() - startedAt;

  const chunkRows = await pool.query(
    'SELECT chunk_index, content, (embedding IS NOT NULL) AS has_embedding, vector_dims(embedding) AS dims FROM chunks WHERE document_id = $1 ORDER BY chunk_index ASC',
    [documentId]
  );

  const embeddedStatus = await embeddingService.getEmbeddingStatus(documentId);

  summary.ingestion = {
    documentId,
    status: result?.status,
    progress: result?.progress,
    ingestionMs,
    chunkCount: chunkRows.rows.length,
    chunksWithEmbedding: chunkRows.rows.filter((r) => r.has_embedding).length,
    allDims384: chunkRows.rows.every((r) => r.dims === 384),
    embeddingStatus: embeddedStatus
  };
  summary.chunks = chunkRows.rows.map((r) => ({ index: r.chunk_index, len: r.content.length, head: r.content.slice(0, 60).replace(/\s+/g, ' ') }));

  const searchService = createSearchService({ embeddingProvider: provider, searchRepository, defaultTopK: 10, maxTopK: 25 });
  const searchStartedAt = Date.now();
  const { matches } = await searchService.search(QUERY, { userId: USER_ID, limit: 5 });
  summary.retrieval = {
    query: QUERY,
    searchMs: Date.now() - searchStartedAt,
    matchCount: matches.length,
    top: matches.slice(0, 3).map((m) => ({ chunkIndex: m.chunkIndex, similarity: Number(m.similarity.toFixed(4)), head: m.chunkText.slice(0, 60).replace(/\s+/g, ' ') }))
  };
  summary.retrieval.topContainsThirtyDays = (matches[0]?.chunkText || '').toLowerCase().includes('thirty days');
  summary.retrieval.passed = summary.retrieval.topContainsThirtyDays;

  const failedDocumentId = randomUUID();
  await documentsRepository.insertDocument({
    id: failedDocumentId,
    userId: USER_ID,
    fileName: 'invalid-embedding.txt',
    fileType: 'txt',
    fileSizeBytes: txtSize,
    storagePath: TXT_PATH,
    extractedText: '',
    sourceType: 'upload',
    status: 'uploaded',
    progress: 0
  });

  const badProvider = {
    async embedMany(texts) {
      return texts.map(() => [0.1, 0.2, 0.3]);
    },
    async embed() {
      return [0.1, 0.2, 0.3];
    }
  };
  const badEmbeddingService = createEmbeddingService({ documentsRepository, embeddingRepository, embeddingProvider: badProvider, batchSize: 8 });
  const badOrchestrator = createDocumentOrchestrator({ documentsRepository, chunkService, embeddingService: badEmbeddingService, ocrService });

  const failedResult = await badOrchestrator.processDocument(failedDocumentId);
  const persistedFailure = await documentsRepository.getDocumentById(failedDocumentId);
  const failureReason = persistedFailure?.failureReason ?? '';
  summary.invalidEmbeddingCase = {
    providerBehaviour: 'embedMany returns a 3-dim vector (wrong dimensions)',
    returnedStatus: failedResult?.status,
    persistedStatus: persistedFailure?.status,
    failureReason,
    failureReasonLength: failureReason.length,
    mentionsDimensions: /dimension/i.test(failureReason),
    passed: persistedFailure?.status === 'failed'
      && failureReason.length > 0
      && failureReason.length <= 300
      && /dimension/i.test(failureReason)
  };

  summary.counts = await countRows();
  summary.overallPassed = summary.ingestion.status === 'ready'
    && summary.ingestion.chunkCount > 0
    && summary.ingestion.chunksWithEmbedding === summary.ingestion.chunkCount
    && summary.ingestion.allDims384
    && summary.retrieval.passed
    && summary.invalidEmbeddingCase.passed;

  await pool.query('DELETE FROM documents WHERE user_id = $1', [USER_ID]);

  console.log(JSON.stringify(summary, null, 2));
  console.log(summary.overallPassed ? '\nE2E RESULT: PASS' : '\nE2E RESULT: FAIL');

  if (!summary.overallPassed) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
