import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConversationDocumentRepository } from '../../server/chat/conversationDocumentRepository.js';

function createRecorder(result) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return result;
    },
  };
}

test('attachDocument refuses failed documents in the insert query', async () => {
  const pool = createRecorder({ rowCount: 0, rows: [] });
  const repository = new ConversationDocumentRepository(pool);

  const result = await repository.attachDocument('conversation-1', 'failed-doc', 'user-1');

  assert.equal(result, null);
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].text, /status <> 'failed'/);
  assert.deepEqual(pool.calls[0].params, ['conversation-1', 'failed-doc', 'user-1']);
});

test('attachDocument returns the attachment when the insert succeeds', async () => {
  const pool = createRecorder({
    rowCount: 1,
    rows: [{
      conversation_id: 'conversation-1',
      document_id: 'doc-1',
      created_at: '2026-10-27T00:00:00.000Z',
    }],
  });
  const repository = new ConversationDocumentRepository(pool);

  const result = await repository.attachDocument('conversation-1', 'doc-1', 'user-1');

  assert.deepEqual(result, {
    conversationId: 'conversation-1',
    documentId: 'doc-1',
    createdAt: '2026-10-27T00:00:00.000Z',
  });
});
