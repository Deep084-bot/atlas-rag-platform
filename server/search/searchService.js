import { EmbeddingSpaceError, ProviderError, ValidationError } from '../errors.js';
import { resolveDimensionsForService } from '../embeddings/embeddingSpaces.js';

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function describeIncompatibleSpaces(spaces) {
  return spaces
    .map((entry) => `${entry.spaceId} (${entry.chunkCount})`)
    .join(', ');
}

export function createSearchService({
  embeddingProvider,
  searchRepository,
  defaultTopK = 10,
  maxTopK = 25,
  dimensions,
  space = null
} = {}) {
  const embeddingDimensions = resolveDimensionsForService({ dimensions, provider: embeddingProvider, space });
  const includeLegacyUnknown = space?.legacyUnknownPolicy === 'include';

  if (space && typeof searchRepository?.summarizeIncompatibleEmbeddings !== 'function') {
    throw new ValidationError(
      `Search for embedding space "${space.id}" requires compatibility checks before retrieval.`
    );
  }

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

      if (space) {
        const incompatible = await searchRepository.summarizeIncompatibleEmbeddings({
          spaceId: space.id,
          includeLegacyUnknown
        });

        if (incompatible.total > 0) {
          throw new EmbeddingSpaceError(
            `Search is blocked: ${incompatible.total} stored embedding(s) do not belong to the active `
              + `space "${space.id}" (${describeIncompatibleSpaces(incompatible.spaces)}). `
              + 'Re-embed those documents or switch back to their embedding space before searching.',
            {
              spaceId: space.id,
              incompatibleSpaces: incompatible.spaces
            }
          );
        }
      }

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
      if (queryEmbedding.length !== embeddingDimensions) {
        throw new ProviderError('Embedding provider returned query embedding with unexpected dimensions.', {
          provider: 'Embedding provider',
          statusCode: 502
        });
      }

      const matches = await searchRepository.searchChunksByEmbeddingForUser({
        userId: normalizedUserId,
        embedding: queryEmbedding,
        limit: topK,
        conversationId,
        spaceId: space?.id ?? null,
        includeLegacyUnknown
      });

      return { matches };
    }
  };
}