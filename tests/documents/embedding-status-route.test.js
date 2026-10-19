import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDocumentsRouter } from '../../server/documents/routes.js';

const EMBEDDING_STATUS = {
  documentId: 'doc-1',
  totalChunks: 2,
  embeddedChunks: 2,
  complete: true
};

function createRouter({ embeddingStatus = EMBEDDING_STATUS } = {}) {
  const calls = { getDocumentByIdForUser: [], getEmbeddingStatus: [] };
  const documentsOwnedByUser1 = new Set(['doc-1']);

  const documentsRepository = {
    async getDocumentByIdForUser(id, userId) {
      calls.getDocumentByIdForUser.push({ id, userId });
      return userId === 'user-1' && documentsOwnedByUser1.has(id) ? { id } : null;
    }
  };

  const embeddingService = {
    async getEmbeddingStatus(id) {
      calls.getEmbeddingStatus.push({ id });
      return embeddingStatus;
    }
  };

  const router = createDocumentsRouter({
    storageProvider: {},
    documentsRepository,
    chunkService: {},
    embeddingService,
    documentOrchestrator: {},
    conversationDocumentRepository: {}
  });

  return { router, calls };
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

async function invoke(router, { url, user } = {}) {
  const { response, done } = createCapture();
  const request = { method: 'GET', url, headers: {}, user };
  router(request, response, () => done());
  await done;
  return { status: response.statusCode, body: response.body };
}

// ---------------------------------------------------------------------------
// GET /:id/embeddings/status — authorization and ownership
// ---------------------------------------------------------------------------

test('unauthenticated requests to the embedding-status endpoint are rejected with 401', async () => {
  const { router, calls } = createRouter();
  const result = await invoke(router, { url: '/doc-1/embeddings/status', user: undefined });

  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'unauthorized');
  assert.equal(calls.getDocumentByIdForUser.length, 0, 'ownership is never resolved without a session');
  assert.equal(calls.getEmbeddingStatus.length, 0, 'no embedding status is read for an unauthenticated caller');
});

test('an authenticated user cannot read another user\'s embedding status', async () => {
  const { router, calls } = createRouter();
  const result = await invoke(router, { url: '/doc-1/embeddings/status', user: { id: 'intruder' } });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'document_not_found');
  assert.equal(calls.getDocumentByIdForUser.length, 1);
  assert.equal(calls.getDocumentByIdForUser[0].userId, 'intruder');
  assert.equal(calls.getEmbeddingStatus.length, 0, 'another user\'s embedding state is never read');
});

test('the legitimate owner retains access to the embedding-status endpoint', async () => {
  const { router, calls } = createRouter();
  const result = await invoke(router, { url: '/doc-1/embeddings/status', user: { id: 'user-1' } });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, EMBEDDING_STATUS);
  assert.equal(calls.getEmbeddingStatus.length, 1);
  assert.equal(calls.getEmbeddingStatus[0].id, 'doc-1');
});

test('a missing document for the authenticated owner is reported as 404', async () => {
  const { router, calls } = createRouter();
  const result = await invoke(router, { url: '/missing/embeddings/status', user: { id: 'user-1' } });

  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'document_not_found');
  assert.equal(calls.getEmbeddingStatus.length, 0);
});
