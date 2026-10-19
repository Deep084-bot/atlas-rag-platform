import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDocumentsRouter } from '../../server/documents/routes.js';
import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';

const DEFAULT_DOCUMENT = { id: 'doc-1', status: 'chunking', progress: 60, failureReason: null };

function createRepository({ document = DEFAULT_DOCUMENT, forUser, onGetById, order = [] } = {}) {
  const calls = { updateStatus: [], lockForUpdate: [], markReady: [], markFailed: [] };

  return {
    calls,
    async getDocumentByIdForUser(id, userId) {
      if (forUser === null) {
        return null;
      }
      return forUser ?? document;
    },
    async getDocumentById(id) {
      if (onGetById) {
        return onGetById(id);
      }
      return document;
    },
    async updateStatus(id, payload, options = {}) {
      calls.updateStatus.push({ id, payload, client: options.client ?? null });
      return { id, ...payload };
    },
    async lockForUpdate(id, options = {}) {
      calls.lockForUpdate.push({ id, client: options.client ?? null });
      order.push('lock');
      return document ? { id } : null;
    },
    async markReady(id, payload, options = {}) {
      calls.markReady.push({ id, payload, client: options.client ?? null });
      order.push('markReady');
      return { id, status: 'ready', progress: payload.progress, failureReason: null };
    },
    async markFailed(id, payload, options = {}) {
      calls.markFailed.push({ id, payload, client: options.client ?? null });
      order.push('markFailed');
      return { id, status: 'failed', failureReason: payload.failureReason, progress: payload.progress };
    }
  };
}

function createEmbeddingService({ embedResult, embedError, probe, order = [] }) {
  const calls = { embedDocument: 0, getEmbeddingStatus: [] };

  return {
    calls,
    async embedDocument(id) {
      calls.embedDocument += 1;
      order.push('embedDocument');
      if (embedError) {
        throw embedError;
      }
      return embedResult;
    },
    async getEmbeddingStatus(id, options = {}) {
      calls.getEmbeddingStatus.push({ id, client: options.client ?? null });
      order.push('getEmbeddingStatus');
      return probe(id, options);
    }
  };
}

function createRouter({ documentsRepository, documentOrchestrator, embeddingService = {} }) {
  return createDocumentsRouter({
    storageProvider: {},
    documentsRepository,
    chunkService: {},
    embeddingService,
    documentOrchestrator,
    conversationDocumentRepository: {}
  });
}

function createCapture() {
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      resolveDone();
      return this;
    },
    end() {
      this.body = undefined;
      resolveDone();
      return this;
    }
  };

  return { response, done };
}

async function invoke(router, { method = 'POST', url, user = { id: 'user-1' }, body = {} } = {}) {
  const { response, done } = createCapture();
  const request = { method, url, headers: {}, user, body };
  router(request, response, () => done());
  await done;
  return { status: response.statusCode, body: response.body };
}

// ---------------------------------------------------------------------------
// Lifecycle harness: a real orchestrator, scripted embed/probe behaviour
// ---------------------------------------------------------------------------

function buildLifecycle({ embedResult, embedError, probe, document = DEFAULT_DOCUMENT, order = [] }) {
  const documentsRepository = createRepository({ document, order });
  const embeddingService = createEmbeddingService({ embedResult, embedError, probe, order });
  const documentOrchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService,
    ocrService: null,
    runInTransaction: (fn) => fn({ __txClient: true })
  });

  return { documentsRepository, embeddingService, documentOrchestrator };
}

// ---------------------------------------------------------------------------
// Lifecycle: readiness is published only after completeness verification
// ---------------------------------------------------------------------------

test('manual embedding verifies completeness before publishing readiness', async () => {
  const order = [];
  const { documentsRepository, embeddingService, documentOrchestrator } = buildLifecycle({
    order,
    embedResult: { documentId: 'doc-1', embeddedChunks: 2 },
    probe: () => ({ documentId: 'doc-1', totalChunks: 2, embeddedChunks: 2, complete: true })
  });

  const router = createRouter({ documentsRepository, documentOrchestrator, embeddingService });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 200);
  assert.deepEqual(
    Object.keys(result.body).sort(),
    ['documentId', 'failureReason', 'progress', 'status'].sort(),
    'the response exposes the document lifecycle, not raw embedding internals'
  );
  assert.equal(result.body.documentId, 'doc-1');
  assert.equal(result.body.status, 'ready');

  assert.equal(embeddingService.calls.embedDocument, 1);
  assert.equal(documentsRepository.calls.markReady.length, 1);
  assert.ok(
    order.indexOf('getEmbeddingStatus') < order.indexOf('markReady'),
    'completeness is verified before the document is marked ready'
  );
  assert.ok(
    order.indexOf('lock') < order.indexOf('markReady'),
    'readiness is published under the document row lock'
  );
});

test('a provider failure is not published as readiness', async () => {
  const order = [];
  const { documentsRepository, embeddingService, documentOrchestrator } = buildLifecycle({
    order,
    embedError: new Error('provider exploded'),
    probe: () => ({ complete: true })
  });

  const router = createRouter({ documentsRepository, documentOrchestrator, embeddingService });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'document_embed_failed');
  assert.equal(documentsRepository.calls.markReady.length, 0);
  assert.equal(documentsRepository.calls.markFailed.length, 1);
  assert.ok(!order.includes('getEmbeddingStatus'), 'no completeness probe runs after a failed embed');
});

test('incomplete embeddings are not published as readiness', async () => {
  const order = [];
  const { documentsRepository, embeddingService, documentOrchestrator } = buildLifecycle({
    order,
    embedResult: { documentId: 'doc-1', embeddedChunks: 1 },
    probe: () => ({ documentId: 'doc-1', totalChunks: 2, embeddedChunks: 1, complete: false })
  });

  const router = createRouter({ documentsRepository, documentOrchestrator, embeddingService });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'document_embed_failed');
  assert.equal(documentsRepository.calls.markReady.length, 0);
  assert.equal(documentsRepository.calls.markFailed.length, 1);
  assert.ok(
    order.indexOf('getEmbeddingStatus') < order.indexOf('markFailed'),
    'an incomplete probe fails the document instead of publishing readiness'
  );
});

test('a skipped Voyage backfill that is still incomplete is reported as in-progress, not ready', async () => {
  const order = [];
  const { documentsRepository, embeddingService, documentOrchestrator } = buildLifecycle({
    order,
    embedResult: { documentId: 'doc-1', spaceId: 'voyage-3', status: 'skipped', embeddedChunks: 0, totalChunks: 2 },
    probe: () => ({ documentId: 'doc-1', totalChunks: 2, embeddedChunks: 0, complete: false }),
    document: { id: 'doc-1', status: 'embedding', progress: 90, failureReason: null }
  });

  const router = createRouter({ documentsRepository, documentOrchestrator, embeddingService });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 202);
  assert.equal(result.body.documentId, 'doc-1');
  assert.equal(result.body.status, 'embedding');
  assert.equal(documentsRepository.calls.markReady.length, 0);
  assert.equal(documentsRepository.calls.markFailed.length, 0, 'a hand-off is neither ready nor failed');
});

// ---------------------------------------------------------------------------
// Route-level HTTP response mapping and contract
// ---------------------------------------------------------------------------

test('missing document is reported as 404 and never enters the lifecycle', async () => {
  const documentsRepository = createRepository({ forUser: null });
  let reembedCalls = 0;
  const documentOrchestrator = {
    async reembedDocument() {
      reembedCalls += 1;
      return null;
    }
  };

  const router = createRouter({ documentsRepository, documentOrchestrator });
  const result = await invoke(router, { url: '/missing/embed' });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'document_not_found');
  assert.equal(reembedCalls, 0, 'the lifecycle is never entered for a missing document');
});

test('a document deleted under the lifecycle is reported as 404', async () => {
  const documentsRepository = createRepository({ onGetById: () => null });
  const documentOrchestrator = { async reembedDocument() { return null; } };

  const router = createRouter({ documentsRepository, documentOrchestrator });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'document_not_found');
});

test('a failed lifecycle result is reported as 500 with the failure reason', async () => {
  const documentsRepository = createRepository();
  const documentOrchestrator = {
    async reembedDocument() {
      return { id: 'doc-1', status: 'failed', progress: 100, failureReason: 'provider exploded' };
    }
  };

  const router = createRouter({ documentsRepository, documentOrchestrator });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'document_embed_failed');
  assert.equal(result.body.category, 'embedding');
  assert.equal(result.body.status, 'failed');
  assert.equal(result.body.failureReason, 'provider exploded');
  assert.match(result.body.message, /provider exploded/);
});

test('a 503 is returned when the embedding lifecycle is not configured', async () => {
  const documentsRepository = createRepository();
  const router = createRouter({ documentsRepository, documentOrchestrator: null });
  const result = await invoke(router, { url: '/doc-1/embed' });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'document_embed_unavailable');
});

test('unauthenticated requests are rejected before any lifecycle work', async () => {
  const documentsRepository = createRepository();
  let reembedCalls = 0;
  const documentOrchestrator = {
    async reembedDocument() {
      reembedCalls += 1;
      return null;
    }
  };

  const router = createRouter({ documentsRepository, documentOrchestrator });
  const result = await invoke(router, { url: '/doc-1/embed', user: null });

  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'unauthorized');
  assert.equal(reembedCalls, 0);
});
