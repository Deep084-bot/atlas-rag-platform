import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmbeddingService } from '../../server/embeddings/embeddingService.js';
import { LocalTransformersProvider } from '../../server/embeddings/LocalTransformersProvider.js';

test('embedDocument throws if provider returns wrong count', async () => {
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }, { id: 'c2', content: 'there' }],
    updateChunkEmbedding: async () => null
  };
  const provider = {
    embedMany: async () => [Array(384).fill(0.1)]
  };
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });
  await assert.rejects(async () => service.embedDocument('d1'), (err) => err.name === 'ProviderError' && err.message.includes('unexpected number'));
});

test('embedDocument throws if embedding is empty', async () => {
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }],
    updateChunkEmbedding: async () => null
  };
  const provider = {
    embedMany: async () => [[]]
  };
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });
  await assert.rejects(async () => service.embedDocument('d1'), (err) => err.name === 'ProviderError' && err.message.includes('empty embedding'));
});

test('embedDocument throws if embedding has wrong dimension', async () => {
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }],
    updateChunkEmbedding: async () => null
  };
  const provider = {
    embedMany: async () => [Array(10).fill(0.1)]
  };
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });
  await assert.rejects(async () => service.embedDocument('d1'), (err) => err.name === 'ProviderError' && err.message.includes('dimensions'));
});

test('embedDocument throws if embedding has non-finite values', async () => {
  const bad = Array(384).fill(0.1);
  bad[5] = Infinity;
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }],
    updateChunkEmbedding: async () => null
  };
  const provider = {
    embedMany: async () => [bad]
  };
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });
  await assert.rejects(async () => service.embedDocument('d1'), (err) => err.name === 'ProviderError' && err.message.includes('invalid'));
});

test('embedDocument persists valid embeddings and reports counts', async () => {
  const persisted = [];
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [
      { id: 'c1', content: 'hi' },
      { id: 'c2', content: 'there' }
    ],
    updateChunkEmbedding: async (id, embedding) => {
      persisted.push({ id, length: embedding.length });
      return null;
    }
  };
  const provider = {
    embedMany: async () => [Array(384).fill(0.1), Array(384).fill(0.2)]
  };
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });
  const result = await service.embedDocument('d1');
  assert.equal(result.embeddedChunks, 2);
  assert.equal(persisted.length, 2);
  assert.deepEqual(persisted.map((p) => p.id), ['c1', 'c2']);
  assert.ok(persisted.every((p) => p.length === 384));
});

test('embedDocument propagates local provider initialization failure', async () => {
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }],
    updateChunkEmbedding: async () => {
      throw new Error('embedding should not be persisted when initialization fails');
    }
  };
  const provider = new LocalTransformersProvider({
    loadExtractor: async () => {
      throw new Error('model files unavailable');
    }
  });
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });

  await assert.rejects(
    () => service.embedDocument('d1'),
    (error) =>
      error.name === 'ProviderError' &&
      error.provider === 'local' &&
      /failed to initialize/.test(error.message)
  );
});

test('embedDocument propagates local provider inference failure', async () => {
  const docsRepo = {
    getDocumentById: async () => ({ id: 'd1' })
  };
  const embRepo = {
    getChunksForDocument: async () => [{ id: 'c1', content: 'hi' }],
    updateChunkEmbedding: async () => null
  };
  const provider = new LocalTransformersProvider({
    loadExtractor: async () =>
      (async () => {
        throw new Error('onnx runtime crashed');
      })
  });
  const service = createEmbeddingService({ documentsRepository: docsRepo, embeddingRepository: embRepo, embeddingProvider: provider });

  await assert.rejects(
    () => service.embedDocument('d1'),
    (error) => error.name === 'ProviderError' && /inference failed/.test(error.message)
  );
});
