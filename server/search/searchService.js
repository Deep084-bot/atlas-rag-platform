function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function createSearchService({ embeddingProvider, searchRepository, defaultTopK = 10, maxTopK = 25 }) {
  return {
    async search(query, { limit } = {}) {
      const normalizedQuery = typeof query === 'string' ? query.trim() : '';

      if (!normalizedQuery) {
        throw new Error('query is required.');
      }

      const requestedLimit = parsePositiveInteger(limit, defaultTopK);
      const topK = Math.min(requestedLimit, maxTopK);
      const queryEmbedding = await embeddingProvider.embed(normalizedQuery);

      if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        throw new Error('Embedding provider returned an empty query embedding.');
      }

      const matches = await searchRepository.searchChunksByEmbedding(queryEmbedding, topK);

      return { matches };
    }
  };
}