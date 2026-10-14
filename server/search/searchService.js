import { ProviderError, ValidationError } from '../errors.js';

const EMBEDDING_DIMENSIONS = 384;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function createSearchService({ embeddingProvider, searchRepository, defaultTopK = 10, maxTopK = 25 }) {
  return {
    async search(query, { limit, userId, conversationId } = {}) {
      const normalizedQuery = typeof query === 'string' ? query.trim() : '';

      if (!normalizedQuery) {
        throw new ValidationError('query is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const requestedLimit = parsePositiveInteger(limit, defaultTopK);
      const topK = Math.min(requestedLimit, maxTopK);
      const queryEmbedding = await embeddingProvider.embed(normalizedQuery);

      if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
        throw new ProviderError('Embedding provider returned an empty query embedding.', {
          provider: 'Embedding provider',
          statusCode: 502
        });
      }
      if (!queryEmbedding.every((item) => Number.isFinite(item))) {
        throw new ProviderError('Embedding provider returned invalid query embedding values.', {
          provider: 'Embedding provider',
          statusCode: 502
        });
      }
      if (queryEmbedding.length !== EMBEDDING_DIMENSIONS) {
        throw new ProviderError('Embedding provider returned query embedding with unexpected dimensions.', {
          provider: 'Embedding provider',
          statusCode: 502
        });
      }

      const matches = await searchRepository.searchChunksByEmbeddingForUser({
        userId: normalizedUserId,
        embedding: queryEmbedding,
        limit: topK,
        conversationId
      });

      return { matches };
    }
  };
}