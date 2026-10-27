import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseDocumentIds,
  selectMessageAttachments,
} from '../../server/chat/messageAttachments.js';

const CONVERSATION_DOCUMENTS = [
  { id: 'doc-1', fileName: 'project-atlas.txt', fileType: 'txt', status: 'ready' },
  { id: 'doc-2', fileName: 'notes.pdf', fileType: 'pdf', status: 'ready' },
];

test('accepts an omitted or empty document id list', () => {
  assert.deepEqual(parseDocumentIds(undefined), []);
  assert.deepEqual(parseDocumentIds(null), []);
  assert.deepEqual(parseDocumentIds([]), []);
});

test('normalizes requested document ids without duplicates', () => {
  assert.deepEqual(parseDocumentIds([' doc-1 ', 'doc-2', 'doc-1']), ['doc-1', 'doc-2']);
});

test('rejects malformed document id lists', () => {
  assert.equal(parseDocumentIds('doc-1'), null);
  assert.equal(parseDocumentIds(['doc-1', 42]), null);
  assert.equal(parseDocumentIds(['doc-1', '']), null);
});

test('selects multiple attachments in request order', () => {
  assert.deepEqual(
    selectMessageAttachments(CONVERSATION_DOCUMENTS, ['doc-2', 'doc-1']),
    [
      { id: 'doc-2', fileName: 'notes.pdf', fileType: 'pdf' },
      { id: 'doc-1', fileName: 'project-atlas.txt', fileType: 'txt' },
    ],
  );
});

test('filters documents not attached to the authorized conversation', () => {
  assert.deepEqual(
    selectMessageAttachments(CONVERSATION_DOCUMENTS, ['doc-1', 'other-user-doc']),
    [{ id: 'doc-1', fileName: 'project-atlas.txt', fileType: 'txt' }],
  );
  assert.deepEqual(selectMessageAttachments(CONVERSATION_DOCUMENTS, []), []);
});

test('uses safe fallbacks for partial metadata', () => {
  assert.deepEqual(
    selectMessageAttachments([{ id: 'doc-3' }], ['doc-3']),
    [{ id: 'doc-3', fileName: 'Document', fileType: null }],
  );
});
