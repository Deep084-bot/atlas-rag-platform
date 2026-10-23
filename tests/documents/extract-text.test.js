import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateDocumentUpload, extractTextFromUpload } from '../../server/documents/extractText.js';
import { UploadValidationError } from '../../server/documents/errors.js';

test('markdown files are accepted by extension and mime type', () => {
  assert.deepEqual(validateDocumentUpload({ mimeType: '', originalName: 'notes.md' }), { fileType: 'md' });
  assert.deepEqual(validateDocumentUpload({ mimeType: '', originalName: 'NOTES.MD' }), { fileType: 'md' });
  assert.deepEqual(validateDocumentUpload({ mimeType: '', originalName: 'notes.markdown' }), { fileType: 'md' });
  assert.deepEqual(validateDocumentUpload({ mimeType: 'text/markdown', originalName: 'notes' }), { fileType: 'md' });
  assert.deepEqual(validateDocumentUpload({ mimeType: 'text/x-markdown', originalName: 'notes' }), { fileType: 'md' });
});

test('markdown extraction normalizes and preserves text content', async () => {
  const result = await extractTextFromUpload({
    buffer: Buffer.from('# Title\r\n\r\nBody'),
    mimeType: 'text/markdown',
    originalName: 'notes.md'
  });

  assert.equal(result.fileType, 'md');
  assert.equal(result.extractedText, '# Title\n\nBody');
});

test('empty markdown is rejected', async () => {
  await assert.rejects(
    () => extractTextFromUpload({
      buffer: Buffer.from('  \n\t'),
      mimeType: 'text/markdown',
      originalName: 'empty.md'
    }),
    UploadValidationError
  );
});

test('docx is still rejected and reports the supported formats', () => {
  assert.throws(
    () => validateDocumentUpload({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      originalName: 'report.docx'
    }),
    /Only PDF, TXT, and Markdown files are allowed/
  );
});
