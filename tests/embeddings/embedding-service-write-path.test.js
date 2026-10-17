import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEmbeddingService } from '../../server/embeddings/embeddingService.js';
import { BGE_SPACE, VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { DatabaseError, ValidationError } from '../../server/errors.js';

function baseRepos() {
  return {
    documentsRepository: { getDocumentById: async () => ({ id: 'doc-1' }) },
    embeddingRepository: {
      getChunksForDocument: async () => [{ id: 'chunk-1', content: 'hello' }],
      updateChunkEmbedding: async () => null,
      countTotalChunks: async () => 1,
      countEmbeddedChunks: async () => 1
    }
  };
}

test('default service (no space) writes through the legacy chunks.embedding column', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const legacyWrites = [];
  embeddingRepository.updateChunkEmbedding = async (id, embedding) => {
    legacyWrites.push({ id, length: embedding.length });
    return null;
  };
  let tableWrites = 0;
  const chunkEmbeddingRepository = {
    upsertChunkEmbedding: async () => {
      tableWrites += 1;
      return { chunkId: 'chunk-1' };
    }
  };
  const provider = { embedMany: async () => [Array(384).fill(0.1)] };

  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository,
    embeddingProvider: provider
  });

  const result = await service.embedDocument('doc-1');

  assert.equal(result.embeddedChunks, 1);
  assert.deepEqual(legacyWrites, [{ id: 'chunk-1', length: 384 }]);
  assert.equal(tableWrites, 0);
});

test('explicit BGE space still writes through the legacy column', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const legacyWrites = [];
  embeddingRepository.updateChunkEmbedding = async (id) => {
    legacyWrites.push(id);
    return null;
  };
  const provider = { embedMany: async () => [Array(384).fill(0.1)] };

  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    embeddingProvider: provider,
    space: BGE_SPACE
  });

  await service.embedDocument('doc-1');
  assert.deepEqual(legacyWrites, ['chunk-1']);
});

test('Voyage embedDocument delegates to the coordinated backfill runner', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  let legacyWrites = 0;
  embeddingRepository.updateChunkEmbedding = async () => {
    legacyWrites += 1;
    return null;
  };
  const providerCalls = [];
  const provider = { embedMany: async (texts) => { providerCalls.push(texts); return [Array(1024).fill(0.1)]; } };
  const delegated = [];
  const embeddingBackfillRunner = {
    async backfillDocument(documentId) {
      delegated.push(documentId);
      return { documentId, spaceId: VOYAGE_SPACE.id, status: 'completed', embeddedChunks: 1, totalChunks: 1 };
    }
  };

  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository: { upsertChunkEmbedding: async () => ({ chunkId: 'chunk-1' }) },
    embeddingBackfillRunner,
    embeddingProvider: provider,
    space: VOYAGE_SPACE
  });

  const result = await service.embedDocument('doc-1');

  assert.deepEqual(delegated, ['doc-1']);
  assert.equal(result.status, 'completed');
  assert.equal(result.embeddedChunks, 1);
  assert.equal(providerCalls.length, 0, 'the service never calls the provider directly for a table space');
  assert.equal(legacyWrites, 0);
});

test('Voyage embedDocument fails closed without a coordinated backfill runner', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const providerCalls = [];
  const provider = { embedMany: async (texts) => { providerCalls.push(texts); return [Array(1024).fill(0.1)]; } };

  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository: { upsertChunkEmbedding: async () => ({ chunkId: 'chunk-1' }) },
    embeddingProvider: provider,
    space: VOYAGE_SPACE
  });

  await assert.rejects(() => service.embedDocument('doc-1'), ValidationError);
  assert.equal(providerCalls.length, 0, 'no provider call may happen without a lease');
});

test('Voyage space requires a chunk embedding repository', () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const provider = { embedMany: async () => [Array(1024).fill(0.1)] };

  assert.throws(
    () => createEmbeddingService({
      documentsRepository,
      embeddingRepository,
      embeddingProvider: provider,
      space: VOYAGE_SPACE
    }),
    ValidationError
  );
});

test('Voyage embedDocument surfaces a runner failure without touching the legacy column', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  let legacyWrites = 0;
  embeddingRepository.updateChunkEmbedding = async () => {
    legacyWrites += 1;
    return null;
  };
  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository: { upsertChunkEmbedding: async () => ({ chunkId: 'chunk-1' }) },
    embeddingBackfillRunner: {
      async backfillDocument() {
        throw new DatabaseError('runner exploded');
      }
    },
    embeddingProvider: { embedMany: async () => [Array(1024).fill(0.1)] },
    space: VOYAGE_SPACE
  });

  await assert.rejects(() => service.embedDocument('doc-1'), DatabaseError);
  assert.equal(legacyWrites, 0);
});

test('getEmbeddingStatus is scoped to the active space and identity-based', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository: {
      isDocumentFullyEmbedded: async (documentId, spaceId) => {
        assert.equal(documentId, 'doc-1');
        assert.equal(spaceId, VOYAGE_SPACE.id);
        return { totalChunks: 3, embeddedChunks: 2, missingChunks: 1, complete: false };
      }
    },
    embeddingProvider: { embedMany: async () => [] },
    space: VOYAGE_SPACE
  });

  const status = await service.getEmbeddingStatus('doc-1');

  assert.deepEqual(status, {
    documentId: 'doc-1',
    spaceId: VOYAGE_SPACE.id,
    totalChunks: 3,
    embeddedChunks: 2,
    missingChunks: 1,
    complete: false
  });
});

test('getEmbeddingStatus does not trust coincidentally-equal counts', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    chunkEmbeddingRepository: {
      // Identity check says the document is NOT fully embedded even though a
      // naive count comparison would (e.g. an orphan embedding row).
      isDocumentFullyEmbedded: async () => ({ totalChunks: 2, embeddedChunks: 1, missingChunks: 1, complete: false })
    },
    embeddingProvider: { embedMany: async () => [] },
    space: VOYAGE_SPACE
  });

  const status = await service.getEmbeddingStatus('doc-1');

  assert.equal(status.complete, false);
  assert.equal(status.missingChunks, 1);
});

test('getEmbeddingStatus keeps the legacy shape for BGE', async () => {
  const { documentsRepository, embeddingRepository } = baseRepos();
  embeddingRepository.countTotalChunks = async () => 2;
  embeddingRepository.countEmbeddedChunks = async () => 2;
  const service = createEmbeddingService({
    documentsRepository,
    embeddingRepository,
    embeddingProvider: { embedMany: async () => [] },
    space: BGE_SPACE
  });

  const status = await service.getEmbeddingStatus('doc-1');
  assert.deepEqual(status, {
    documentId: 'doc-1',
    totalChunks: 2,
    embeddedChunks: 2,
    complete: true
  });
});
