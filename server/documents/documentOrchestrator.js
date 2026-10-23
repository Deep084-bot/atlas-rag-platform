import { readFile } from 'node:fs/promises';

import { extractTextFromUpload } from './extractText.js';
import { ProviderError } from '../errors.js';

const OCR_TEXT_MIN_LENGTH = 50;
const MAX_OCR_PAGES = 10;
const MAX_OCR_FILE_SIZE = (Number.parseInt(process.env.MAX_OCR_FILE_SIZE_MB, 10) || 15) * 1024 * 1024;
const OCR_QUALITY_THRESHOLD = 0.30;
const MAX_FAILURE_REASON_LENGTH = 300;

const HOSTED_PROVIDERS = new Set(['Hugging Face', 'Voyage']);

function describeHostedProviderError(error) {
  const provider = error.provider;
  const status = Number.isFinite(error.statusCode) ? error.statusCode : null;

  if (status === 401 || status === 403) {
    return `${provider} authentication failed (status ${status}). Check the provider API key and permissions.`;
  }

  if (status === 402) {
    return `${provider} rejected the request (status 402). The provider account may be out of credits or over quota.`;
  }

  if (status === 429) {
    return `${provider} rate limit exceeded (status 429). Try again later.`;
  }

  if (status !== null && status >= 500) {
    return `${provider} is temporarily unavailable (status ${status}). Try again later.`;
  }

  if (status !== null) {
    return `${provider} request failed (status ${status}).`;
  }

  return `${provider} request failed.`;
}

function sanitizeFailureReason(error) {
  let raw;

  if (error instanceof ProviderError && HOSTED_PROVIDERS.has(error.provider)) {
    raw = describeHostedProviderError(error);
  } else if (error instanceof Error && typeof error.message === 'string') {
    raw = error.message;
  } else {
    raw = 'Document ingestion failed.';
  }

  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) {
    return 'Document ingestion failed.';
  }

  if (cleaned.length > MAX_FAILURE_REASON_LENGTH) {
    return `${cleaned.slice(0, MAX_FAILURE_REASON_LENGTH - 1).trimEnd()}…`;
  }

  return cleaned;
}

const DICTIONARY = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'an', 'in', 'is', 'it',
  'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with',
  'his', 'they', 'at', 'this', 'from', 'or', 'has', 'by', 'have',
  'not', 'but', 'what', 'all', 'were', 'when', 'can', 'said',
  'there', 'use', 'each', 'which', 'she', 'do', 'how', 'their',
  'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then',
  'them', 'these', 'so', 'some', 'her', 'would', 'make', 'like',
  'into', 'than', 'such', 'because', 'also', 'more', 'two',
  'document', 'page', 'file', 'text', 'pdf', 'this', 'that',
  'date', 'name', 'number', 'title', 'section', 'content',
  'summary', 'report', 'information', 'data', 'result'
]);

function computeOcrQuality(text) {
  if (!text || text.length === 0) {
    return { score: 0, alphaRatio: 0, avgWordLength: 0, dictRatio: 0, printableRatio: 0 };
  }

  const total = text.length;
  const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
  const alphaRatio = alphaCount / total;

  const printable = (text.match(/[ -~]/g) || []).length;
  const printableRatio = printable / total;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const avgWordLength = words.length > 0
    ? words.reduce((sum, w) => sum + w.length, 0) / words.length
    : 0;

  const dictWords = words.filter((w) => DICTIONARY.has(w.toLowerCase()));
  const dictRatio = words.length > 0 ? dictWords.length / words.length : 0;

  const score = alphaRatio * 0.4 + Math.min(avgWordLength / 10, 1) * 0.2 + dictRatio * 0.3 + printableRatio * 0.1;

  return { score, alphaRatio, avgWordLength, dictRatio, printableRatio };
}

function mapFileTypeToMimeType(fileType) {
  if (fileType === 'pdf') {
    return 'application/pdf';
  }

  return 'text/plain';
}

// Statuses returned by the table-backed backfill runner that permit the
// document to become `ready`, subject to an authoritative completeness check.
const PUBLISHABLE_BACKFILL_STATUSES = new Set(['completed', 'skipped']);

function describeBackfillFailure(result) {
  const detail = typeof result?.error === 'string' ? result.error.trim() : '';

  return detail.length > 0 ? `Embedding backfill failed: ${detail}` : 'Embedding backfill failed.';
}

export function createDocumentOrchestrator({
  documentsRepository,
  chunkService,
  embeddingService,
  ocrService,
  runInTransaction = null
}) {
  let activeEmbeddingService = embeddingService;

  /**
   * Publish a document as `ready` atomically:
   *
   *   1. open one transaction (bounded `lock_timeout` / `statement_timeout` /
   *      `idle_in_transaction_session_timeout` are applied by the caller's
   *      `runInTransaction`),
   *   2. take the document row lock (`SELECT ... FOR UPDATE`), which serializes
   *      with chunk replacement, deletion, and the backfill runner's completion,
   *   3. authoritatively verify the current chunk set against the active space's
   *      embeddings on the *same* connection,
   *   4. only then transition the document to `ready` on that same connection.
   *
   * Because the verification and the transition share the transaction and the
   * document row lock, a concurrent chunk replacement can never interleave
   * between them. A replacement that wins the lock first makes the new chunk set
   * visible to step 3, so verification fails closed instead of publishing an
   * unembedded document.
   *
   * The probe and the transition must run on the transaction client — running
   * `markReady` against the pool here would deadlock on a second connection that
   * waits for the very row lock this transaction holds.
   */
  async function verifyAndMarkDocumentReady(documentId) {
    if (typeof runInTransaction !== 'function') {
      throw new Error('A transaction runner is required to publish document readiness.');
    }

    if (typeof activeEmbeddingService?.getEmbeddingStatus !== 'function') {
      throw new Error('The active embedding service cannot verify document completeness.');
    }

    return runInTransaction(async (client) => {
      const locked = await documentsRepository.lockForUpdate(documentId, { client });

      if (!locked) {
        // The document was deleted; do not recreate it or publish readiness.
        return { outcome: 'missing' };
      }

      const status = await activeEmbeddingService.getEmbeddingStatus(documentId, { client });

      if (!status) {
        // Disappeared between the lock and the probe: treat as missing.
        return { outcome: 'missing' };
      }

      if (status.complete !== true) {
        return { outcome: 'incomplete' };
      }

      const document = await documentsRepository.markReady(documentId, { progress: 100 }, { client });

      return { outcome: 'ready', document };
    });
  }

  async function embedDocumentAndMarkReady(documentId, processingStartedAt) {
    await documentsRepository.updateStatus(documentId, {
      status: 'embedding',
      progress: 90,
      failureReason: null,
      processingStartedAt
    });

    if (!activeEmbeddingService) {
      throw new Error('Embedding service is not configured.');
    }

    const result = await activeEmbeddingService.embedDocument(documentId);

    // A null/undefined result is the legacy/repository contract for a document
    // that no longer exists. Never publish it, and never mark it failed: there
    // is nothing left to transition.
    if (result === null || result === undefined) {
      return null;
    }

    const isBackfillResult = Object.prototype.hasOwnProperty.call(result, 'status');

    if (isBackfillResult) {
      const { status } = result;

      if (status === 'failed') {
        // Route into the existing failure-persistence path; markReady is never reached.
        throw new Error(describeBackfillFailure(result));
      }

      if (status === 'ineligible') {
        // The runner refused to embed because the document is not in a state the
        // active policy allows (see `embeddingEligibility.js`). Never publish
        // readiness and never mark it failed: the document's owning transition
        // (deletion, reprocessing, or an operator sweep) is responsible for its
        // next state. Publishing `ready` here would report embeddings we never
        // produced.
        return null;
      }

      if (status === 'missing') {
        // The runner verified the document no longer exists; leave it alone.
        return null;
      }

      if (!PUBLISHABLE_BACKFILL_STATUSES.has(status)) {
        // Unknown or malformed status: fail closed rather than guess.
        throw new Error(
          `Embedding backfill returned an unrecognised status${
            typeof status === 'string' ? ` "${status}"` : ''
          }; refusing to mark the document ready.`
        );
      }
    }

    const readiness = await verifyAndMarkDocumentReady(documentId);

    if (readiness.outcome === 'missing') {
      // Document disappeared between embedding and verification.
      return null;
    }

    if (readiness.outcome === 'incomplete') {
      // `skipped` means another worker still owns the document. If it is not yet
      // complete, leave it in-progress (the owner or reconcile sweep will finish
      // it) instead of publishing or failing it.
      if (isBackfillResult && result.status === 'skipped') {
        return null;
      }

      throw new Error(
        'Embedding is incomplete for the active embedding space; refusing to mark the document ready.'
      );
    }

    return readiness.document;
  }

  async function persistFailure(documentId, error) {
    const failureReason = sanitizeFailureReason(error);

    try {
      return await documentsRepository.markFailed(documentId, {
        failureReason,
        progress: 100
      });
    } catch (markError) {
      const markMessage = markError instanceof Error ? markError.message : 'Failed to persist document failure.';
      throw new Error(`${failureReason} (and failed to persist failure state: ${markMessage})`);
    }
  }

  const inFlightIngestions = new Set();

  async function claimDocumentForIngestion(documentId) {
    const document = await documentsRepository.getDocumentById(documentId);

    if (!document) {
      return { outcome: 'missing' };
    }

    if (document.status === 'ready') {
      return { outcome: 'settled', document };
    }

    if (['extracting', 'ocr', 'chunking', 'embedding'].includes(document.status)) {
      return { outcome: 'settled', document };
    }

    const processingStartedAt = new Date().toISOString();

    await documentsRepository.updateStatus(documentId, {
      status: 'extracting',
      progress: 30,
      failureReason: null,
      processingStartedAt
    });

    return {
      outcome: 'claimed',
      document: { ...document, status: 'extracting', progress: 30 },
      processingStartedAt
    };
  }

  async function runClaimedIngestion(documentId, document, processingStartedAt) {
    try {
      const buffer = await readFile(document.storagePath);
      const extracted = await extractTextFromUpload({
        buffer,
        mimeType: mapFileTypeToMimeType(document.fileType),
        originalName: document.fileName
      });

      let finalText = extracted.extractedText;
      let finalFileType = extracted.fileType;

      console.log('[OCR] Extraction result', {
        documentId,
        extractedTextLength: extracted.extractedText.length,
        fileType: extracted.fileType
      });

      if (
        extracted.fileType === 'pdf'
        && extracted.extractedText.length < OCR_TEXT_MIN_LENGTH
        && ocrService
      ) {
        if (document.file_size_bytes > MAX_OCR_FILE_SIZE) {
          throw new Error(
            `This scanned PDF is too large for OCR (max ${MAX_OCR_FILE_SIZE / 1024 / 1024} MB).`
          );
        }

        await documentsRepository.updateStatus(documentId, {
          status: 'ocr',
          progress: 45,
          failureReason: null,
          processingStartedAt
        });

        console.log('[OCR] Starting OCR', { documentId });
        const ocrText = await ocrService.ocrPdf(buffer, { maxPages: MAX_OCR_PAGES });
        console.log('[OCR] OCR complete', {
          documentId,
          textLength: ocrText ? ocrText.length : 0
        });

        if (process.env.NODE_ENV !== 'production') {
          console.log('[OCR TEXT SAMPLE]');
          console.log(ocrText ? ocrText.slice(0, 2000) : '(empty)');
        }

        if (!ocrText) {
          throw new Error('OCR was unable to extract text from this PDF. Ensure pages contain readable text.');
        }

        finalText = ocrText;
      }

      const ocrQuality = computeOcrQuality(finalText);
      console.log('[OCR QUALITY]', {
        documentId,
        score: ocrQuality.score.toFixed(4),
        alphaRatio: ocrQuality.alphaRatio.toFixed(4),
        avgWordLength: ocrQuality.avgWordLength.toFixed(2),
        dictRatio: ocrQuality.dictRatio.toFixed(4),
        printableRatio: ocrQuality.printableRatio.toFixed(4),
        lowQuality: ocrQuality.score < OCR_QUALITY_THRESHOLD,
        textLength: finalText.length
      });

      await documentsRepository.updateOcrQuality(documentId, ocrQuality.score);

      await documentsRepository.updateDocumentText(documentId, {
        extractedText: finalText,
        fileType: finalFileType
      });

      await documentsRepository.updateStatus(documentId, {
        status: 'chunking',
        progress: 60,
        failureReason: null,
        processingStartedAt
      });

      await chunkService.chunkDocument(documentId);

      return await embedDocumentAndMarkReady(documentId, processingStartedAt);
    } catch (error) {
      return await persistFailure(documentId, error);
    }
  }

  return {
    setEmbeddingService(nextEmbeddingService) {
      activeEmbeddingService = nextEmbeddingService;
    },

    async startDocumentIngestion(documentId) {
      let claim;

      try {
        claim = await claimDocumentForIngestion(documentId);
      } catch (error) {
        try {
          await persistFailure(documentId, error);
        } catch (persistError) {
          const message = persistError instanceof Error ? persistError.message : 'Failed to persist document failure.';
          console.error(`Document ingestion failed for ${documentId}: ${message}`);
        }

        return null;
      }

      if (claim.outcome !== 'claimed') {
        return claim.document ?? null;
      }

      const task = runClaimedIngestion(documentId, claim.document, claim.processingStartedAt)
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Document ingestion failed.';
          console.error(`Document ingestion failed for ${documentId}: ${message}`);
        })
        .finally(() => {
          inFlightIngestions.delete(task);
        });

      inFlightIngestions.add(task);

      return claim.document;
    },

    async processDocument(documentId) {
      let claim;

      try {
        claim = await claimDocumentForIngestion(documentId);
      } catch (error) {
        return await persistFailure(documentId, error);
      }

      if (claim.outcome !== 'claimed') {
        return claim.document ?? null;
      }

      return await runClaimedIngestion(documentId, claim.document, claim.processingStartedAt);
    },

    async drainIngestion() {
      if (inFlightIngestions.size === 0) {
        return;
      }

      await Promise.allSettled([...inFlightIngestions]);
    },

    async reembedDocument(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const processingStartedAt = new Date().toISOString();

      try {
        return await embedDocumentAndMarkReady(documentId, processingStartedAt);
      } catch (error) {
        return await persistFailure(documentId, error);
      }
    }
  };
}