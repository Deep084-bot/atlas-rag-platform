import { readFile } from 'node:fs/promises';

import { extractTextFromUpload } from './extractText.js';

const OCR_TEXT_MIN_LENGTH = 50;
const MAX_OCR_PAGES = 10;
const MAX_OCR_FILE_SIZE = (Number.parseInt(process.env.MAX_OCR_FILE_SIZE_MB, 10) || 15) * 1024 * 1024;
const OCR_QUALITY_THRESHOLD = 0.30;

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

export function createDocumentOrchestrator({ documentsRepository, chunkService, embeddingService, ocrService }) {
  let activeEmbeddingService = embeddingService;

  return {
    setEmbeddingService(nextEmbeddingService) {
      activeEmbeddingService = nextEmbeddingService;
    },

    async startDocumentIngestion(documentId) {
      void this.processDocument(documentId).catch((error) => {
        const message = error instanceof Error ? error.message : 'Document ingestion failed.';
        console.error(`Document ingestion failed for ${documentId}: ${message}`);
      });
    },

    async processDocument(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      if (document.status === 'ready') {
        return document;
      }

      if (['extracting', 'ocr', 'chunking', 'embedding'].includes(document.status)) {
        return document;
      }

      const processingStartedAt = new Date().toISOString();

      try {
        await documentsRepository.updateStatus(documentId, {
          status: 'extracting',
          progress: 30,
          failureReason: null,
          processingStartedAt
        });

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

        await documentsRepository.updateStatus(documentId, {
          status: 'embedding',
          progress: 90,
          failureReason: null,
          processingStartedAt
        });

        if (!activeEmbeddingService) {
          throw new Error('Embedding service is not configured.');
        }

        await activeEmbeddingService.embedDocument(documentId);

        return await documentsRepository.markReady(documentId, {
          progress: 100
        });
      } catch (error) {
        const failureReason = error instanceof Error ? error.message : 'Document ingestion failed.';

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
    }
  };
}