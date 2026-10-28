import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSearchService } from '../../server/search/searchService.js';
import { HOSTED_BGE_SPACE, LOCAL_BGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';

test('search rejects empty query embedding before querying the repository', async () => {
  let repoCalled = false;
  const fakeProvider = {
    embed: async () => []
  };
  const fakeRepo = {
    searchChunksByEmbeddingForUser: async () => {
      repoCalled = true;
      return [];
    }
  };
  const service = createSearchService({ embeddingProvider: fakeProvider, searchRepository: fakeRepo });
  await assert.rejects(
    async () => service.search('hello', { userId: 'u1' }),
    (err) => err instanceof Error && err.message.includes('empty query embedding')
  );
  assert.equal(repoCalled, false);
});

test('search rejects query embedding with unexpected dimensions before querying the repository', async () => {
  let repoCalled = false;
  const fakeProvider = {
    embed: async () => Array(10).fill(0.1)
  };
  const fakeRepo = {
    searchChunksByEmbeddingForUser: async () => {
      repoCalled = true;
      return [];
    }
  };
  const service = createSearchService({ embeddingProvider: fakeProvider, searchRepository: fakeRepo });
  await assert.rejects(
    async () => service.search('hello', { userId: 'u1' }),
    (err) => err instanceof Error && err.message.includes('dimensions')
  );
  assert.equal(repoCalled, false);
});

test('search rejects query embedding with non-finite values before querying the repository', async () => {
  let repoCalled = false;
  const bad = Array(384).fill(0.1);
  bad[0] = NaN;
  const fakeProvider = {
    embed: async () => bad
  };
  const fakeRepo = {
    searchChunksByEmbeddingForUser: async () => {
      repoCalled = true;
      return [];
    }
  };
  const service = createSearchService({ embeddingProvider: fakeProvider, searchRepository: fakeRepo });
  await assert.rejects(
    async () => service.search('hello', { userId: 'u1' }),
    (err) => err instanceof Error && err.message.includes('invalid')
  );
  assert.equal(repoCalled, false);
});

test('search propagates provider failure without converting to generic error', async () => {
  const { ProviderError } = await import('../../server/errors.js');
  const fakeProvider = {
    embed: async () => {
      throw new ProviderError('Hugging Face request failed with status 402.', { provider: 'Hugging Face', statusCode: 502, upstreamStatusCode: 402 });
    }
  };
  const fakeRepo = {
    searchChunksByEmbeddingForUser: async () => {
      throw new Error('repository should not be called');
    }
  };
  const service = createSearchService({ embeddingProvider: fakeProvider, searchRepository: fakeRepo });
  await assert.rejects(
    async () => service.search('hello', { userId: 'u1' }),
    (err) => err.name === 'ProviderError' && err.statusCode === 502 && err.upstreamStatusCode === 402
  );
});

test('search issues repository query for a valid query embedding', async () => {
  let receivedArgs = null;
  const fakeProvider = {
    embed: async () => Array(384).fill(0.1)
  };
  const fakeRepo = {
    searchChunksByEmbeddingForUser: async (args) => {
      receivedArgs = args;
      return [];
    }
  };
  const service = createSearchService({ embeddingProvider: fakeProvider, searchRepository: fakeRepo });
  const result = await service.search('hello', { userId: 'u1' });
  assert.ok(receivedArgs);
  assert.equal(receivedArgs.userId, 'u1');
  assert.equal(receivedArgs.embedding.length, 384);
  assert.deepEqual(result, { matches: [] });
});

test('search blocks retrieval when stored vectors belong to another embedding space', async () => {
  let providerCalled = false;
  let searchCalled = false;
  const fakeProvider = {
    embed: async () => {
      providerCalled = true;
      return Array(384).fill(0.1);
    }
  };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 2,
      spaces: [{ spaceId: 'bge-small-en-v1.5-hosted-l2-v1', chunkCount: 2 }]
    }),
    searchChunksByEmbeddingForUser: async () => {
      searchCalled = true;
      return [];
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    async () => service.search('hello', { userId: 'u1' }),
    (error) =>
      error.name === 'EmbeddingSpaceError' &&
      error.statusCode === 503 &&
      /Search is blocked/.test(error.message) &&
      /bge-small-en-v1.5-hosted-l2-v1 \(2\)/.test(error.message)
  );
  assert.equal(providerCalled, false);
  assert.equal(searchCalled, false);
});

test('hosted search blocks legacy unknown vectors by default', async () => {
  let receivedArgs = null;
  let guardArgs = null;
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async (args) => {
      guardArgs = args;
      return { total: 0, spaces: [] };
    },
    searchChunksByEmbeddingForUser: async (args) => {
      receivedArgs = args;
      return [];
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: HOSTED_BGE_SPACE
  });

  await service.search('hello', { userId: 'u1' });

  assert.deepEqual(guardArgs, {
    spaceId: HOSTED_BGE_SPACE.id,
    includeLegacyUnknown: false
  });
  assert.equal(receivedArgs.spaceId, HOSTED_BGE_SPACE.id);
  assert.equal(receivedArgs.includeLegacyUnknown, false);
});

test('hosted compatibility mode includes legacy unknown vectors only when explicitly requested', async () => {
  const compatibilitySpace = Object.freeze({ ...HOSTED_BGE_SPACE, legacyUnknownPolicy: 'include' });
  let receivedArgs = null;
  let guardArgs = null;
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async (args) => {
      guardArgs = args;
      return { total: 0, spaces: [] };
    },
    searchChunksByEmbeddingForUser: async (args) => {
      receivedArgs = args;
      return [];
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: compatibilitySpace
  });

  await service.search('hello', { userId: 'u1' });

  assert.deepEqual(guardArgs, {
    spaceId: compatibilitySpace.id,
    includeLegacyUnknown: true
  });
  assert.equal(receivedArgs.spaceId, compatibilitySpace.id);
  assert.equal(receivedArgs.includeLegacyUnknown, true);
});

test('local search rejects legacy unknown vectors and scopes the query', async () => {
  let receivedArgs = null;
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({ total: 0, spaces: [] }),
    searchChunksByEmbeddingForUser: async (args) => {
      receivedArgs = args;
      return [];
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await service.search('hello', { userId: 'u1' });

  assert.equal(receivedArgs.spaceId, LOCAL_BGE_SPACE.id);
  assert.equal(receivedArgs.includeLegacyUnknown, false);
});

test('search fails closed when a space-aware repository lacks compatibility checks', () => {
  assert.throws(
    () => createSearchService({
      embeddingProvider: { embed: async () => [] },
      searchRepository: { searchChunksByEmbeddingForUser: async () => [] },
      space: LOCAL_BGE_SPACE
    }),
    /requires compatibility checks/
  );
});
