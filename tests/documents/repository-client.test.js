import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { DatabaseError } from '../../server/errors.js';

function createRecorder(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows };
    }
  };
}

const row = {
  id: 'doc-1',
  file_name: 'doc.txt',
  file_type: 'txt',
  file_size_bytes: 10,
  storage_path: null,
  source_type: 'upload',
  status: 'embedding',
  progress: 90,
  failure_reason: null,
  processing_started_at: null,
  ready_at: null,
  failed_at: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z'
};

test('updateStatus runs on the supplied transaction client', async () => {
  const pool = createRecorder([row]);
  const client = createRecorder([row]);
  const repository = new DocumentsRepository(pool);

  await repository.updateStatus('doc-1', { status: 'embedding', progress: 90 }, { client });

  assert.equal(pool.calls.length, 0);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].params.slice(0, 3), ['doc-1', 'embedding', 90]);
});

test('markReady and markFailed route through the client without using the pool', async () => {
  const pool = createRecorder([row]);
  const client = createRecorder([row]);
  const repository = new DocumentsRepository(pool);

  await repository.markReady('doc-1', { progress: 100 }, { client });
  await repository.markFailed('doc-1', { failureReason: 'boom' }, { client });

  assert.equal(pool.calls.length, 0);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].params[1], 'ready');
  assert.equal(client.calls[1].params[1], 'failed');
});

test('getDocumentById runs on the supplied transaction client', async () => {
  const pool = createRecorder([row]);
  const client = createRecorder([row]);
  const repository = new DocumentsRepository(pool);

  const document = await repository.getDocumentById('doc-1', { client });

  assert.equal(pool.calls.length, 0);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].params, ['doc-1']);
  assert.equal(document.id, 'doc-1');
});

test('the client-aware helpers fall back to the pool and fail closed without a pool', async () => {
  const pool = createRecorder([row]);
  const repository = new DocumentsRepository(pool);

  await repository.updateStatus('doc-1', { status: 'embedding', progress: 90 });
  await repository.getDocumentById('doc-1');

  assert.equal(pool.calls.length, 2);

  const unconfigured = new DocumentsRepository(null);
  await assert.rejects(() => unconfigured.updateStatus('doc-1', { status: 'embedding' }), DatabaseError);
  await assert.rejects(() => unconfigured.getDocumentById('doc-1'), DatabaseError);
});
