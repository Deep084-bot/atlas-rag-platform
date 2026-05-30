import { chunkText } from './chunkText.js';

export function createChunkService({ documentsRepository, chunkRepository }) {
  return {
    async chunkDocument(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const chunks = chunkText(document.extractedText ?? '');
      const storedChunks = await chunkRepository.replaceDocumentChunks(documentId, chunks);

      return {
        documentId,
        chunksCreated: storedChunks.length
      };
    },

    async listDocumentChunks(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const chunks = await chunkRepository.listDocumentChunks(documentId);

      return {
        documentId,
        chunks
      };
    }
  };
}
