export function createEmbeddingService({ documentsRepository, embeddingRepository, embeddingProvider, batchSize = 8 }) {
  return {
    async embedDocument(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const chunks = await embeddingRepository.getChunksForDocument(documentId);

      if (chunks.length === 0) {
        return {
          documentId,
          embeddedChunks: 0
        };
      }

      let embeddedChunks = 0;

      for (let index = 0; index < chunks.length; index += batchSize) {
        const batch = chunks.slice(index, index + batchSize);
        const embeddings = await embeddingProvider.embedMany(batch.map((chunk) => chunk.content));

        if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
          throw new Error('Embedding provider returned an unexpected number of embeddings.');
        }

        for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
          const chunk = batch[batchIndex];
          const embedding = embeddings[batchIndex];

          await embeddingRepository.updateChunkEmbedding(chunk.id, embedding);
          embeddedChunks += 1;
        }
      }

      return {
        documentId,
        embeddedChunks
      };
    },

    async getEmbeddingStatus(documentId) {
      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const [totalChunks, embeddedChunks] = await Promise.all([
        embeddingRepository.countTotalChunks(documentId),
        embeddingRepository.countEmbeddedChunks(documentId)
      ]);

      return {
        documentId,
        totalChunks,
        embeddedChunks,
        complete: totalChunks === embeddedChunks
      };
    }
  };
}
