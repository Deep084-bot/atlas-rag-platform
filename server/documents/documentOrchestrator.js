import { readFile } from 'node:fs/promises';

import { extractTextFromUpload } from './extractText.js';

function mapFileTypeToMimeType(fileType) {
  if (fileType === 'pdf') {
    return 'application/pdf';
  }

  return 'text/plain';
}

export function createDocumentOrchestrator({ documentsRepository, chunkService, embeddingService }) {
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

      if (['extracting', 'chunking', 'embedding'].includes(document.status)) {
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

        await documentsRepository.updateDocumentText(documentId, {
          extractedText: extracted.extractedText,
          fileType: extracted.fileType
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