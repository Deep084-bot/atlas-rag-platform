import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';
import { ProviderError } from '../../server/errors.js';

function createDocsRepo(overrides = {}) {
  const calls = { updateStatus: [], markReady: [], markFailed: [] };

  return {
    calls,
    async getDocumentById() {
      return { id: 'doc-1', status: 'ready' };
    },
    async updateStatus(id, payload) {
      calls.updateStatus.push({ id, payload });
      return { id, ...payload };
    },
    async markReady(id, payload) {
      calls.markReady.push({ id, payload });
      return { id, status: 'ready', progress: payload.progress };
    },
    async markFailed(id, payload) {
      calls.markFailed.push({ id, payload });
      return { id, status: 'failed', failureReason: payload.failureReason };
    },
    ...overrides
  };
}

test('reembedDocument re-embeds then marks the document ready', async () => {
  const documentsRepository = createDocsRepo();
  let embedded = 0;
  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService: { embedDocument: async () => { embedded += 1; return { embeddedChunks: 2 }; } },
    ocrService: null
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(embedded, 1);
  assert.equal(result.status, 'ready');
  assert.equal(documentsRepository.calls.updateStatus[0].payload.status, 'embedding');
  assert.equal(documentsRepository.calls.markReady.length, 1);
  assert.equal(documentsRepository.calls.markFailed.length, 0);
});

test('reembedDocument marks the document failed without marking ready on error', async () => {
  const documentsRepository = createDocsRepo();
  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService: { embedDocument: async () => { throw new Error('embedding exploded'); } },
    ocrService: null
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(documentsRepository.calls.markReady.length, 0);
  assert.equal(documentsRepository.calls.markFailed.length, 1);
  assert.equal(documentsRepository.calls.markFailed[0].payload.failureReason, 'embedding exploded');
});

test('reembedDocument sanitizes hosted provider errors', async () => {
  const documentsRepository = createDocsRepo();
  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService: {
      embedDocument: async () => {
        throw new ProviderError('Voyage request failed with status 429: {"detail":"rate limited"}', {
          provider: 'Voyage',
          statusCode: 429
        });
      }
    },
    ocrService: null
  });

  await orchestrator.reembedDocument('doc-1');

  const reason = documentsRepository.calls.markFailed[0].payload.failureReason;
  assert.match(reason, /status 429/);
  assert.ok(!reason.includes('rate limited'));
});

test('reembedDocument returns null when the document does not exist', async () => {
  const documentsRepository = createDocsRepo({ getDocumentById: async () => null });
  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService: { embedDocument: async () => ({}) },
    ocrService: null
  });

  const result = await orchestrator.reembedDocument('missing');

  assert.equal(result, null);
  assert.equal(documentsRepository.calls.markReady.length, 0);
  assert.equal(documentsRepository.calls.markFailed.length, 0);
});
