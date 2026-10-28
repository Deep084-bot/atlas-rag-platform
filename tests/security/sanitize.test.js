import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  redactFilesystemPaths,
  redactSecrets,
  sanitizePublicErrorDetail,
  sanitizeServerLogDetail
} from '../../server/security/sanitize.js';

const UNSAFE_DETAIL = [
  'ENOENT: cannot read /Users/alice/.cache/atlas/models/tokenizer.json',
  'HF_API_KEY=sk-live-secret',
  'Authorization: Bearer abc.def.ghi',
  'postgresql://atlas:db-password@localhost:5432/atlas'
].join(' ');

test('public diagnostics redact filesystem paths, secrets, and database URLs', () => {
  const sanitized = sanitizePublicErrorDetail(UNSAFE_DETAIL);

  assert.doesNotMatch(sanitized, /\/Users\/alice/);
  assert.doesNotMatch(sanitized, /sk-live-secret/);
  assert.doesNotMatch(sanitized, /abc\.def\.ghi/);
  assert.doesNotMatch(sanitized, /db-password/);
  assert.match(sanitized, /<path>/);
  assert.match(sanitized, /HF_API_KEY=<redacted>/);
  assert.match(sanitized, /postgres:\/\/<redacted>/);
});

test('server diagnostics retain paths for operators but still redact credentials', () => {
  const sanitized = sanitizeServerLogDetail(UNSAFE_DETAIL);

  assert.match(sanitized, /\/Users\/alice\/\.cache\/atlas/);
  assert.doesNotMatch(sanitized, /sk-live-secret/);
  assert.doesNotMatch(sanitized, /abc\.def\.ghi/);
  assert.doesNotMatch(sanitized, /db-password/);
});

test('public diagnostics are normalized and bounded', () => {
  const sanitized = sanitizePublicErrorDetail(`line one\n\tline two ${'x'.repeat(500)}`);

  assert.doesNotMatch(sanitized, /[\r\n\t]/);
  assert.ok(sanitized.length <= 300);
  assert.match(sanitized, /line one line two/);
});

test('redaction helpers tolerate non-string and empty values', () => {
  assert.equal(redactSecrets(undefined), '');
  assert.equal(redactFilesystemPaths(null), '');
  assert.equal(sanitizePublicErrorDetail(''), '');
});
