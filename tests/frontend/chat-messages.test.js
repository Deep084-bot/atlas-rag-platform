import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeMessage,
  snapshotMessageAttachments,
} from '../../web/src/hooks/chatMessages.js';

test('normalizes multiple persisted message attachments', () => {
  const message = normalizeMessage({
    id: 'message-1',
    role: 'user',
    content: 'Compare these files',
    attachments: [
      { id: 'doc-1', fileName: 'project-atlas.txt', fileType: 'txt' },
      { id: 'doc-2', fileName: 'notes.pdf', fileType: 'pdf' },
    ],
  });

  assert.deepEqual(message.attachments, [
    { id: 'doc-1', fileName: 'project-atlas.txt', fileType: 'txt' },
    { id: 'doc-2', fileName: 'notes.pdf', fileType: 'pdf' },
  ]);
});

test('handles older messages that have no attachment metadata', () => {
  const message = normalizeMessage({
    id: 'message-old',
    role: 'user',
    content: 'Legacy message',
    citations: [],
  });

  assert.deepEqual(message.attachments, []);
  assert.deepEqual(message.sources, []);
});

test('snapshots only documents that are actually part of the outgoing message', () => {
  const attachments = snapshotMessageAttachments([
    { id: 'doc-1', fileName: 'kept.txt', fileType: 'txt', status: 'ready' },
    { id: 'doc-2', fileName: 'removed.txt', fileType: 'txt', status: 'ready' },
  ]);

  assert.deepEqual(attachments, [
    { id: 'doc-1', fileName: 'kept.txt', fileType: 'txt' },
    { id: 'doc-2', fileName: 'removed.txt', fileType: 'txt' },
  ]);
  assert.deepEqual(snapshotMessageAttachments(attachments.filter((item) => item.id !== 'doc-2')), [
    { id: 'doc-1', fileName: 'kept.txt', fileType: 'txt' },
  ]);
});

test('returns no attachment metadata for a new conversation without attachments', () => {
  assert.deepEqual(snapshotMessageAttachments([]), []);
  assert.deepEqual(snapshotMessageAttachments(undefined), []);
  assert.deepEqual(normalizeMessage({ id: 'm', role: 'user', content: 'Hello' }).attachments, []);
});

test('drops malformed and duplicate attachment entries', () => {
  assert.deepEqual(
    snapshotMessageAttachments([
      null,
      { id: '' },
      { id: 'doc-1', fileName: 'one.txt', fileType: 'txt' },
      { id: 'doc-1', fileName: 'duplicate.txt', fileType: 'txt' },
      { id: 42 },
    ]),
    [{ id: 'doc-1', fileName: 'one.txt', fileType: 'txt' }],
  );
});
