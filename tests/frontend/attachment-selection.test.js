import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attachableDocuments,
  collectPendingDocumentIds,
  isDocumentAttachable,
  pendingAttachmentDocuments,
  unattachedDocumentIds,
} from '../../web/src/hooks/attachmentSelection.js';

test('collectPendingDocumentIds includes direct and collection documents without duplicates', () => {
  const ids = collectPendingDocumentIds({
    documentIds: ['direct-1', 'shared', 'direct-1'],
    collectionIds: ['collection-1', 'missing-collection'],
    collections: [
      { id: 'collection-1', documentIds: ['shared', 'collection-doc'] },
    ],
  });

  assert.deepEqual(ids, ['direct-1', 'shared', 'collection-doc']);
});

test('collectPendingDocumentIds ignores empty and non-string ids', () => {
  const ids = collectPendingDocumentIds({
    documentIds: ['', null, undefined, 'doc-1'],
    collectionIds: ['collection-1'],
    collections: [{ id: 'collection-1', documentIds: [null, 'doc-2'] }],
  });

  assert.deepEqual(ids, ['doc-1', 'doc-2']);
});

test('pendingAttachmentDocuments resolves pending ids against the document library', () => {
  const documents = pendingAttachmentDocuments({
    documentIds: ['direct-1'],
    collectionIds: ['collection-1'],
    collections: [{ id: 'collection-1', documentIds: ['collection-doc'] }],
    documents: [
      { id: 'collection-doc', fileName: 'collection.txt' },
      { id: 'other-doc', fileName: 'other.txt' },
      { id: 'direct-1', fileName: 'direct.txt' },
    ],
  });

  assert.deepEqual(documents.map((document) => document.id), ['collection-doc', 'direct-1']);
});

test('unattachedDocumentIds excludes documents already linked to the conversation', () => {
  const ids = unattachedDocumentIds(
    ['doc-1', 'doc-2', 'doc-3'],
    [{ id: 'doc-2' }],
  );

  assert.deepEqual(ids, ['doc-1', 'doc-3']);
});

test('unattachedDocumentIds handles empty lists', () => {
  assert.deepEqual(unattachedDocumentIds(), []);
  assert.deepEqual(unattachedDocumentIds(['doc-1']), ['doc-1']);
});

test('failed documents are not attachable', () => {
  assert.equal(isDocumentAttachable({ id: 'failed', status: 'failed' }), false);
  assert.equal(isDocumentAttachable({ id: 'ready', status: 'ready' }), true);
  assert.equal(isDocumentAttachable({ id: 'processing', status: 'chunking' }), true);
  assert.equal(isDocumentAttachable(null), true);
});

test('attachableDocuments excludes failed documents only', () => {
  const documents = [
    { id: 'ready', status: 'ready' },
    { id: 'failed', status: 'failed' },
    { id: 'processing', status: 'embedding' },
  ];

  assert.deepEqual(attachableDocuments(documents).map((doc) => doc.id), ['ready', 'processing']);
  assert.deepEqual(attachableDocuments(), []);
});
