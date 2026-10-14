import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSearchService } from '../../server/search/searchService.js';

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
      throw new ProviderError('Hugging Face request failed', { provider: 'Hugging Face', statusCode: 402 });
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
    (err) => err.name === 'ProviderError' && err.statusCode === 402
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
