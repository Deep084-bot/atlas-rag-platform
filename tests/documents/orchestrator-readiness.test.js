import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';

function createHarness({
  embedResult,
  embedError,
  probe,
  locked = true,
  document = { id: 'doc-1', status: 'ready' },
  withTransactionRunner = true
} = {}) {
  const client = { __txClient: true };
  const calls = {
    runInTransaction: 0,
    getDocumentById: [],
    updateStatus: [],
    lockForUpdate: [],
    getEmbeddingStatus: [],
    markReady: [],
    markFailed: []
  };

  const documentsRepository = {
    calls,
    async getDocumentById(id, options = {}) {
      calls.getDocumentById.push({ id, client: options.client ?? null });
      return document;
    },
    async updateStatus(id, payload, options = {}) {
      calls.updateStatus.push({ id, payload, client: options.client ?? null });
      return { id, ...payload };
    },
    async lockForUpdate(id, options = {}) {
      calls.lockForUpdate.push({ id, client: options.client ?? null });
      return locked ? { id } : null;
    },
    async markReady(id, payload, options = {}) {
      calls.markReady.push({ id, payload, client: options.client ?? null });
      return { id, status: 'ready', progress: payload.progress };
    },
    async markFailed(id, payload, options = {}) {
      calls.markFailed.push({ id, payload, client: options.client ?? null });
      return { id, status: 'failed', failureReason: payload.failureReason };
    }
  };

  const embeddingService = {
    async embedDocument() {
      if (embedError) {
        throw embedError;
      }
      return embedResult;
    }
  };

  if (probe !== null) {
    const probeFn = probe ?? (async () => ({ complete: true }));

    embeddingService.getEmbeddingStatus = async (id, options = {}) => {
      calls.getEmbeddingStatus.push({ id, client: options.client ?? null });
      return probeFn(id, options);
    };
  }

  const runInTransaction = async (fn) => {
    calls.runInTransaction += 1;
    return fn(client);
  };

  const orchestrator = createDocumentOrchestrator({
    documentsRepository,
    chunkService: {},
    embeddingService,
    ocrService: null,
    runInTransaction: withTransactionRunner ? runInTransaction : undefined
  });

  return { orchestrator, calls, client };
}

test('failed backfill result routes to failure and never marks ready', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'failed', error: 'provider exploded', category: 'provider_error' }
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
  assert.match(calls.markFailed[0].payload.failureReason, /provider exploded/);
});

test('completed backfill result marks ready when the active space is complete', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true, totalChunks: 2, embeddedChunks: 2 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'ready');
  assert.equal(calls.updateStatus[0].payload.status, 'embedding');
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markFailed.length, 0);
});

test('completed backfill result refuses ready when the active space is incomplete', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: false, totalChunks: 2, embeddedChunks: 1 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});

test('skipped backfill result marks ready when the active space is complete', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'skipped' },
    probe: async () => ({ complete: true, totalChunks: 1, embeddedChunks: 1 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'ready');
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markFailed.length, 0);
});

test('skipped backfill result with incomplete space stays not-ready without failing', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'skipped' },
    probe: async () => ({ complete: false, totalChunks: 2, embeddedChunks: 0 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result, null);
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 0);
  assert.equal(calls.updateStatus.at(-1).payload.status, 'embedding');
});

test('missing backfill result never marks ready or failed', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'missing' }
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result, null);
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 0);
});

test('unrecognised string status fails closed', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'hibernating' }
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});

test('malformed non-string status fails closed', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 42 }
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});

test('completeness probe error fails closed without marking ready', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => {
      throw new Error('readback connection lost');
    }
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
  assert.match(calls.markFailed[0].payload.failureReason, /readback connection lost/);
});

test('completeness probe returning null leaves the document untouched', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => null
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result, null);
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 0);
});

test('legacy result without status marks ready when the active space is complete', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { embeddedChunks: 2 },
    probe: async () => ({ complete: true, totalChunks: 2, embeddedChunks: 2 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'ready');
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markFailed.length, 0);
});

test('legacy result without status refuses ready when the active space is incomplete', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { embeddedChunks: 1 },
    probe: async () => ({ complete: false, totalChunks: 2, embeddedChunks: 1 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});

test('legacy result without status fails closed when the service exposes no probe', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { embeddedChunks: 2 },
    probe: null
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});

test('empty document (no chunks) is considered complete and marks ready', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true, totalChunks: 0, embeddedChunks: 0 })
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'ready');
  assert.equal(calls.markReady.length, 1);
});

test('readiness verification and markReady share a single transaction client', async () => {
  const { orchestrator, calls, client } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true, totalChunks: 3, embeddedChunks: 3 })
  });

  await orchestrator.reembedDocument('doc-1');

  assert.equal(calls.runInTransaction, 1, 'exactly one transaction is opened');
  assert.equal(calls.lockForUpdate.length, 1);
  assert.equal(calls.lockForUpdate[0].client, client, 'lock runs on the tx client');
  assert.equal(calls.getEmbeddingStatus.length, 1);
  assert.equal(calls.getEmbeddingStatus[0].client, client, 'verification runs on the tx client');
  assert.equal(calls.markReady.length, 1);
  assert.equal(calls.markReady[0].client, client, 'markReady runs on the tx client');
  assert.equal(
    calls.lockForUpdate[0].client,
    calls.markReady[0].client,
    'the same client is used for lock and publish'
  );
});

test('the pre-embedding status update runs outside the readiness transaction', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true })
  });

  await orchestrator.reembedDocument('doc-1');

  assert.equal(calls.updateStatus[0].payload.status, 'embedding');
  assert.equal(calls.updateStatus[0].client, null, 'status update is not inside the tx client');
});

test('a document deleted under the lock is never marked ready or failed', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true }),
    locked: false
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result, null);
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 0);
  assert.equal(calls.getEmbeddingStatus.length, 0, 'no verification when the row is gone');
});

test('missing transaction runner fails closed and never marks ready', async () => {
  const { orchestrator, calls } = createHarness({
    embedResult: { status: 'completed' },
    probe: async () => ({ complete: true }),
    withTransactionRunner: false
  });

  const result = await orchestrator.reembedDocument('doc-1');

  assert.equal(result.status, 'failed');
  assert.equal(calls.markReady.length, 0);
  assert.equal(calls.markFailed.length, 1);
});
