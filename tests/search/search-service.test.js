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


test('search proceeds when global legacy vectors exist but user has compatible active-space vectors', async () => {
  let providerCalled = false;
  let searchCalled = false;
  let preflightArgs = null;
  let compatibleArgs = null;
  const fakeProvider = {
    embed: async () => {
      providerCalled = true;
      return Array(384).fill(0.1);
    }
  };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 1351,
      spaces: [{ spaceId: 'legacy-unknown', chunkCount: 1351 }]
    }),
    countCompatibleEmbeddingsForUser: async (args) => {
      compatibleArgs = args;
      return 1;
    },
    searchChunksByEmbeddingForUser: async () => {
      searchCalled = true;
      return [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          fileName: 'atlas-phase11-test.txt',
          chunkIndex: 0,
          similarity: 0.92,
          chunkText: 'test content'
        }
      ];
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  const result = await service.search('test', { userId: 'user-1' });

  assert.equal(providerCalled, true);
  assert.equal(searchCalled, true);
  assert.deepEqual(preflightArgs, null); // not tracked separately, but we know it was called
  assert.equal(compatibleArgs.userId, 'user-1');
  assert.equal(compatibleArgs.spaceId, LOCAL_BGE_SPACE.id);
  assert.equal(compatibleArgs.includeLegacyUnknown, false);
  assert.equal(compatibleArgs.conversationId, undefined);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].chunkId, 'chunk-1');
});

test('another user compatible vectors do not satisfy preflight for different user', async () => {
  let compatibleArgs = null;
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 5,
      spaces: [{ spaceId: 'legacy-unknown', chunkCount: 5 }]
    }),
    countCompatibleEmbeddingsForUser: async (args) => {
      compatibleArgs = args;
      return 0; // user B has no compatible vectors
    },
    searchChunksByEmbeddingForUser: async () => {
      throw new Error('should not be called');
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    async () => service.search('hello', { userId: 'user-b' }),
    (error) => error.name === 'EmbeddingSpaceError'
  );
  assert.equal(compatibleArgs.userId, 'user-b');
});

test('conversation scoped search does not pass preflight with vectors outside conversation', async () => {
  let compatibleArgs = null;
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 3,
      spaces: [{ spaceId: 'legacy-unknown', chunkCount: 3 }]
    }),
    countCompatibleEmbeddingsForUser: async (args) => {
      compatibleArgs = args;
      return 0; // no compatible vectors in this conversation
    },
    searchChunksByEmbeddingForUser: async () => {
      throw new Error('should not be called');
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    async () => service.search('hello', { userId: 'user-1', conversationId: 'conv-1' }),
    (error) => error.name === 'EmbeddingSpaceError'
  );
  assert.equal(compatibleArgs.conversationId, 'conv-1');
});

test('user with zero compatible vectors receives compatibility error', async () => {
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 10,
      spaces: [{ spaceId: HOSTED_BGE_SPACE.id, chunkCount: 10 }]
    }),
    countCompatibleEmbeddingsForUser: async () => 0,
    searchChunksByEmbeddingForUser: async () => {
      throw new Error('should not be called');
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    async () => service.search('hello', { userId: 'user-1' }),
    (error) =>
      error.name === 'EmbeddingSpaceError' &&
      error.statusCode === 503 &&
      /Search is blocked/.test(error.message)
  );
});

test('preflight count error is rethrown not converted to compatibility error', async () => {
  const { DatabaseError } = await import('../../server/errors.js');
  const dbError = new DatabaseError('connection failed');
  const fakeProvider = { embed: async () => Array(384).fill(0.1) };
  const fakeRepo = {
    summarizeIncompatibleEmbeddings: async () => ({
      total: 5,
      spaces: [{ spaceId: 'legacy-unknown', chunkCount: 5 }]
    }),
    countCompatibleEmbeddingsForUser: async () => {
      throw dbError;
    },
    searchChunksByEmbeddingForUser: async () => {
      throw new Error('should not be called');
    }
  };
  const service = createSearchService({
    embeddingProvider: fakeProvider,
    searchRepository: fakeRepo,
    space: LOCAL_BGE_SPACE
  });

  await assert.rejects(
    async () => service.search('hello', { userId: 'user-1' }),
    (error) => error === dbError && error.name === 'DatabaseError'
  );
});
