import { DatabaseError, ProviderError, ValidationError } from '../errors.js';
import { resolveDimensionsForService } from './embeddingSpaces.js';
import { computeEmbeddingL2Norm, isTableSpace, resolveEmbeddingWriteTarget } from './embeddingWriteTarget.js';

function assertProviderEmbeddings(embeddings, expectedCount, expectedDimensions) {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new ProviderError('Embedding provider returned an unexpected number of embeddings.', {
      provider: 'Embedding provider',
      statusCode: 502
    });
  }

  for (const embedding of embeddings) {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new ProviderError('Embedding provider returned an empty embedding.', {
        provider: 'Embedding provider',
        statusCode: 502
      });
    }

    if (!embedding.every((value) => Number.isFinite(value))) {
      throw new ProviderError('Embedding provider returned invalid embedding values.', {
        provider: 'Embedding provider',
        statusCode: 502
      });
    }

    if (Number.isFinite(expectedDimensions) && embedding.length !== expectedDimensions) {
      throw new ProviderError('Embedding provider returned embedding with unexpected dimensions.', {
        provider: 'Embedding provider',
        statusCode: 502
      });
    }
  }
}

/**
 * Create the versioned embedding write service.
 *
 * The write target is derived from the active `space`:
 *  - BGE (or no space) resolves to the legacy `chunks.embedding` column, which
 *    keeps existing call sites byte-for-byte compatible.
 *  - Voyage resolves to the `chunk_embeddings` table keyed by
 *    `(chunk_id, space_id)` and never touches `chunks.embedding`. Because that
 *    table is also written by the backfill CLI, the Voyage write path *must* go
 *    through the coordinated backfill runner (claim + resume-only-missing +
 *    verify-under-lock); a Voyage service without one fails closed rather than
 *    writing vectors uncoordinated.
 *
 * There is no silent fallback: a Voyage space without its repository fails
 * construction, and a chunk that disappears mid-write fails the document rather
 * than being reported as indexed.
 */
export function createEmbeddingService({
  documentsRepository,
  embeddingRepository,
  chunkEmbeddingRepository = null,
  embeddingProvider,
  space = null,
  batchSize = 8,
  dimensions,
  embeddingBackfillRunner = null
} = {}) {
  const embeddingDimensions = resolveDimensionsForService({ dimensions, provider: embeddingProvider, space });
  const tableSpace = isTableSpace(space);

  if (space) {
    resolveEmbeddingWriteTarget(space);
  }

  if (tableSpace && !chunkEmbeddingRepository) {
    throw new ValidationError(`Embedding space "${space.id}" requires a chunk embedding repository.`);
  }

  async function persistChunkEmbedding(chunk, embedding) {
    if (!tableSpace) {
      return embeddingRepository.updateChunkEmbedding(chunk.id, embedding, {
        spaceId: space?.id ?? null
      });
    }

    const l2Norm = computeEmbeddingL2Norm(embedding, { dimensions: embeddingDimensions });
    const persisted = await chunkEmbeddingRepository.upsertChunkEmbedding({
      chunkId: chunk.id,
      spaceId: space.id,
      embedding,
      l2Norm
    });

    if (!persisted) {
      throw new DatabaseError(
        `Chunk ${chunk.id} no longer exists; refusing to report its embedding as persisted.`
      );
    }

    return persisted;
  }

  return {
    spaceId: space?.id ?? null,

    async embedDocument(documentId) {
      if (tableSpace) {
        if (!embeddingBackfillRunner || typeof embeddingBackfillRunner.backfillDocument !== 'function') {
          throw new ValidationError(
            `Embedding space "${space.id}" requires a coordinated backfill runner; refusing to write embeddings without a lease.`
          );
        }

        // Delegate: the runner claims the document, embeds only the chunks that
        // are still missing an embedding for this space, and verifies under the
        // document lock before recording completion.
        return embeddingBackfillRunner.backfillDocument(documentId);
      }

      const document = await documentsRepository.getDocumentById(documentId);

      if (!document) {
        return null;
      }

      const chunks = await embeddingRepository.getChunksForDocument(documentId);

      if (chunks.length === 0) {
        return {
          documentId,
          spaceId: space?.id ?? null,
          embeddedChunks: 0
        };
      }

      let embeddedChunks = 0;

      for (let index = 0; index < chunks.length; index += batchSize) {
        const batch = chunks.slice(index, index + batchSize);
        const embeddings = await embeddingProvider.embedMany(batch.map((chunk) => chunk.content));

        assertProviderEmbeddings(embeddings, batch.length, embeddingDimensions);

        for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
          await persistChunkEmbedding(batch[batchIndex], embeddings[batchIndex]);
          embeddedChunks += 1;
        }
      }

      return {
        documentId,
        spaceId: space?.id ?? null,
        embeddedChunks
      };
    },

    async getEmbeddingStatus(documentId, { client = null } = {}) {
      const document = await documentsRepository.getDocumentById(documentId, { client });

      if (!document) {
        return null;
      }

      if (tableSpace) {
        // Identity-based: completeness is decided per chunk id, not by comparing
        // two independent counts. Two counts can coincide while a chunk is still
        // missing an embedding (or an orphan embedding row inflates the total),
        // so the count comparison is not a reliable source of truth.
        const verification = await chunkEmbeddingRepository.isDocumentFullyEmbedded(documentId, space.id, { client });

        return {
          documentId,
          spaceId: space.id,
          legacyUnknownPolicy: space.legacyUnknownPolicy,
          totalChunks: verification.totalChunks,
          embeddedChunks: verification.embeddedChunks,
          missingChunks: verification.missingChunks,
          complete: verification.complete
        };
      }

      const totalChunks = await embeddingRepository.countTotalChunks(documentId, { client });
      const embeddedChunks = await embeddingRepository.countEmbeddedChunks(documentId, {
        client,
        spaceId: space?.id ?? null,
        includeLegacyUnknown: space?.legacyUnknownPolicy === 'include'
      });

      return {
        documentId,
        spaceId: space?.id ?? null,
        legacyUnknownPolicy: space?.legacyUnknownPolicy ?? null,
        totalChunks,
        embeddedChunks,
        complete: totalChunks === embeddedChunks
      };
    }
  };
}
