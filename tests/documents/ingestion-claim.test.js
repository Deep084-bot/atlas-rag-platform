import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';

async function withTempTextFile(contents, callback) {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-claim-'));
  const filePath = join(dir, 'doc.txt');
  await writeFile(filePath, contents, 'utf8');
  try {
    return await callback(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

test('startDocumentIngestion claims the document before resolving', async () => {
  await withTempTextFile('A valid text document with enough content to chunk.', async (filePath) => {
    const gate = deferred();
    const calls = { updateStatus: [], markReady: 0, markFailed: 0 };

    const repository = {
      async getDocumentById() {
        return {
          id: 'doc-1',
          status: 'uploaded',
          progress: 10,
          storagePath: filePath,
          fileType: 'txt',
          fileName: 'doc.txt',
          file_size_bytes: 10
        };
      },
      async updateStatus(id, payload) {
        calls.updateStatus.push(payload);
        return { id, ...payload };
      },
      async updateOcrQuality() {},
      async updateDocumentText() {},
      async lockForUpdate() {
        return { id: 'doc-1' };
      },
      async markReady(id, payload) {
        calls.markReady += 1;
        return { id, status: 'ready', progress: payload.progress };
      },
      async markFailed(id, payload) {
        calls.markFailed += 1;
        return { id, status: 'failed', failureReason: payload.failureReason };
      }
    };

    const chunkService = {
      async chunkDocument() {
        await gate.promise;
      }
    };
    const embeddingService = {
      async embedDocument() {
        return {};
      },
      async getEmbeddingStatus() {
        return { complete: true, totalChunks: 1, embeddedChunks: 1 };
      }
    };

    const orchestrator = createDocumentOrchestrator({
      documentsRepository: repository,
      chunkService,
      embeddingService,
      ocrService: null,
      runInTransaction: (fn) => fn({})
    });

    const claimed = await orchestrator.startDocumentIngestion('doc-1');

    assert.equal(claimed.status, 'extracting');
    assert.equal(calls.updateStatus[0].status, 'extracting');
    assert.equal(calls.updateStatus[0].progress, 30);
    assert.ok(
      !calls.updateStatus.some((call) => call.status === 'chunking'),
      'the claim resolves before background work advances'
    );

    gate.resolve();
    await orchestrator.drainIngestion();

    assert.equal(calls.markReady, 1);
    assert.equal(calls.markFailed, 0);
  });
});

test('startDocumentIngestion persists a failure when the initial read fails', async () => {
  let failureReason = null;

  const orchestrator = createDocumentOrchestrator({
    documentsRepository: {
      async getDocumentById() {
        throw new Error('database read failed');
      },
      async markFailed(id, payload) {
        failureReason = payload.failureReason;
        return { id, status: 'failed', failureReason: payload.failureReason };
      }
    },
    chunkService: {},
    embeddingService: {},
    ocrService: null
  });

  const result = await orchestrator.startDocumentIngestion('doc-2');

  assert.equal(result, null);
  assert.equal(failureReason, 'database read failed');
});

test('processDocument persists a failure when the initial read fails', async () => {
  let failureReason = null;

  const orchestrator = createDocumentOrchestrator({
    documentsRepository: {
      async getDocumentById() {
        throw new Error('database read failed');
      },
      async markFailed(id, payload) {
        failureReason = payload.failureReason;
        return { id, status: 'failed', failureReason: payload.failureReason };
      }
    },
    chunkService: {},
    embeddingService: {},
    ocrService: null
  });

  const result = await orchestrator.processDocument('doc-3');

  assert.equal(result.status, 'failed');
  assert.equal(failureReason, 'database read failed');
});

test('startDocumentIngestion leaves documents that are already processing untouched', async () => {
  let updated = 0;

  const document = { id: 'doc-4', status: 'chunking', progress: 60 };
  const orchestrator = createDocumentOrchestrator({
    documentsRepository: {
      async getDocumentById() {
        return document;
      },
      async updateStatus() {
        updated += 1;
      }
    },
    chunkService: {},
    embeddingService: {},
    ocrService: null
  });

  const result = await orchestrator.startDocumentIngestion('doc-4');

  assert.equal(result, document);
  assert.equal(updated, 0);
});
