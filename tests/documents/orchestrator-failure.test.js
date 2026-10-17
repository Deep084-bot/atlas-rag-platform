import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDocumentOrchestrator } from '../../server/documents/documentOrchestrator.js';
import { ProviderError } from '../../server/errors.js';

async function withTempTextFile(contents, callback) {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-orch-'));
  const filePath = join(dir, 'doc.txt');
  await writeFile(filePath, contents, 'utf8');
  try {
    return await callback(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('orchestrator marks document failed with reason on embedding error', async () => {
  await withTempTextFile('This is a valid text document with enough content to chunk.', async (filePath) => {
    let markFailedArgs = null;
    const docsRepo = {
      getDocumentById: async () => ({
        id: 'd1',
        status: 'uploaded',
        storagePath: filePath,
        fileType: 'txt',
        fileName: 'doc.txt',
        file_size_bytes: 10
      }),
      updateStatus: async () => ({ id: 'd1' }),
      updateDocumentText: async () => ({ id: 'd1' }),
      updateOcrQuality: async () => ({ id: 'd1' }),
      markReady: async () => ({ id: 'd1', status: 'ready' }),
      markFailed: async (id, args) => {
        markFailedArgs = args;
        return { id, status: 'failed', failureReason: args.failureReason };
      }
    };
    const chunkService = { chunkDocument: async () => ({ chunks: [] }) };
    const embService = {
      embedDocument: async () => {
        throw new Error('Embedding provider returned an unexpected number of embeddings.');
      }
    };

    const orch = createDocumentOrchestrator({
      documentsRepository: docsRepo,
      chunkService,
      embeddingService: embService,
      ocrService: null
    });

    const res = await orch.processDocument('d1');
    assert.ok(res);
    assert.equal(res.status, 'failed');
    assert.equal(res.failureReason, 'Embedding provider returned an unexpected number of embeddings.');
    assert.ok(markFailedArgs);
    assert.equal(markFailedArgs.failureReason, 'Embedding provider returned an unexpected number of embeddings.');
  });
});

test('orchestrator marks ready on valid embedding path', async () => {
  await withTempTextFile('This is a valid text document with enough content to chunk.', async (filePath) => {
    let markedReady = false;
    const docsRepo = {
      getDocumentById: async () => ({
        id: 'd2',
        status: 'uploaded',
        storagePath: filePath,
        fileType: 'txt',
        fileName: 'doc.txt',
        file_size_bytes: 10
      }),
      updateStatus: async () => ({ id: 'd2' }),
      updateDocumentText: async () => ({ id: 'd2' }),
      updateOcrQuality: async () => ({ id: 'd2' }),
      markReady: async () => {
        markedReady = true;
        return { id: 'd2', status: 'ready' };
      },
      markFailed: async (id, args) => ({ id, status: 'failed', failureReason: args.failureReason })
    };
    const chunkService = { chunkDocument: async () => ({ chunks: [] }) };
    const embService = { embedDocument: async () => ({ documentId: 'd2', embeddedChunks: 1 }) };

    const orch = createDocumentOrchestrator({
      documentsRepository: docsRepo,
      chunkService,
      embeddingService: embService,
      ocrService: null
    });

    const res = await orch.processDocument('d2');
    assert.equal(res.status, 'ready');
    assert.equal(markedReady, true);
  });
});

test('orchestrator sanitizes failure reason (strips control chars and caps length)', async () => {
  await withTempTextFile('This is a valid text document with enough content to chunk.', async (filePath) => {
    let persistedReason = null;
    const longMessage = `line one\nline two\twith control chars ${'x'.repeat(500)}`;
    const docsRepo = {
      getDocumentById: async () => ({
        id: 'd4',
        status: 'uploaded',
        storagePath: filePath,
        fileType: 'txt',
        fileName: 'doc.txt',
        file_size_bytes: 10
      }),
      updateStatus: async () => ({ id: 'd4' }),
      updateDocumentText: async () => ({ id: 'd4' }),
      updateOcrQuality: async () => ({ id: 'd4' }),
      markReady: async () => ({ id: 'd4', status: 'ready' }),
      markFailed: async (id, args) => {
        persistedReason = args.failureReason;
        return { id, status: 'failed', failureReason: args.failureReason };
      }
    };
    const chunkService = { chunkDocument: async () => ({ chunks: [] }) };
    const embService = { embedDocument: async () => { throw new Error(longMessage); } };

    const orch = createDocumentOrchestrator({
      documentsRepository: docsRepo,
      chunkService,
      embeddingService: embService,
      ocrService: null
    });

    await orch.processDocument('d4');
    assert.ok(persistedReason);
    assert.ok(!persistedReason.includes('\n'));
    assert.ok(!persistedReason.includes('\t'));
    assert.ok(persistedReason.length <= 300);
  });
});

test('orchestrator sanitizes hosted provider errors without leaking provider response', async () => {
  await withTempTextFile('This is a valid text document with enough content to chunk.', async (filePath) => {
    let persistedReason = null;
    const docsRepo = {
      getDocumentById: async () => ({
        id: 'd5',
        status: 'uploaded',
        storagePath: filePath,
        fileType: 'txt',
        fileName: 'doc.txt',
        file_size_bytes: 10
      }),
      updateStatus: async () => ({ id: 'd5' }),
      updateDocumentText: async () => ({ id: 'd5' }),
      updateOcrQuality: async () => ({ id: 'd5' }),
      markReady: async () => ({ id: 'd5', status: 'ready' }),
      markFailed: async (id, args) => {
        persistedReason = args.failureReason;
        return { id, status: 'failed', failureReason: args.failureReason };
      }
    };
    const chunkService = { chunkDocument: async () => ({ chunks: [] }) };
    const embService = {
      embedDocument: async () => {
        throw new ProviderError(
          'Hugging Face request failed with status 402: {"error":"You have no remaining credits."}',
          { provider: 'Hugging Face', statusCode: 402 }
        );
      }
    };

    const orch = createDocumentOrchestrator({
      documentsRepository: docsRepo,
      chunkService,
      embeddingService: embService,
      ocrService: null
    });

    await orch.processDocument('d5');
    assert.ok(persistedReason);
    assert.ok(!persistedReason.includes('no remaining credits'));
    assert.ok(persistedReason.includes('status 402'));
  });
});

test('orchestrator does not mark ready when embedding fails', async () => {
  await withTempTextFile('This is a valid text document with enough content to chunk.', async (filePath) => {
    let markedReady = false;
    const docsRepo = {
      getDocumentById: async () => ({
        id: 'd3',
        status: 'uploaded',
        storagePath: filePath,
        fileType: 'txt',
        fileName: 'doc.txt',
        file_size_bytes: 10
      }),
      updateStatus: async () => ({ id: 'd3' }),
      updateDocumentText: async () => ({ id: 'd3' }),
      updateOcrQuality: async () => ({ id: 'd3' }),
      markReady: async () => {
        markedReady = true;
        return { id: 'd3', status: 'ready' };
      },
      markFailed: async (id, args) => ({ id, status: 'failed', failureReason: args.failureReason })
    };
    const chunkService = { chunkDocument: async () => ({ chunks: [] }) };
    const embService = { embedDocument: async () => { throw new Error('boom'); } };

    const orch = createDocumentOrchestrator({
      documentsRepository: docsRepo,
      chunkService,
      embeddingService: embService,
      ocrService: null
    });

    const res = await orch.processDocument('d3');
    assert.equal(res.status, 'failed');
    assert.equal(markedReady, false);
  });
});
