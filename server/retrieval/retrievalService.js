function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseSimilarityThreshold(value, fallback) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

export function createRetrievalService({ searchService, defaultTopK = 10, maxTopK = 25, defaultSimilarityThreshold = 0.5 }) {
  return {
    async retrieve(query, { topK, similarityThreshold } = {}) {
      const normalizedQuery = typeof query === 'string' ? query.trim() : '';

      if (!normalizedQuery) {
        throw new Error('query is required.');
      }

      const requestedTopK = parsePositiveInteger(topK, defaultTopK);
      const effectiveTopK = Math.min(requestedTopK, maxTopK);
      const effectiveThreshold = parseSimilarityThreshold(similarityThreshold, defaultSimilarityThreshold);
      const { matches } = await searchService.search(normalizedQuery, { limit: effectiveTopK });
      const retrievedContext = matches.filter((match) => Number(match.similarity) >= effectiveThreshold);

      return {
        query: normalizedQuery,
        retrievedContext
      };
    }
  };
}