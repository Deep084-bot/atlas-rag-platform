import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyBackfillError } from '../../server/embeddings/embeddingBackfillRunner.js';

test('backfill failure reasons are sanitized via shared sanitizer', () => {
  const classified = classifyBackfillError(
    new Error('failed at /Users/alice/.cache/atlas with HF_API_KEY=sk-live-secret and postgres://u:p@db.example.com/app')
  );

  assert.doesNotMatch(classified.sanitised, /\/Users\/alice/);
  assert.doesNotMatch(classified.sanitised, /sk-live-secret/);
  assert.doesNotMatch(classified.sanitised, /db\.example\.com/);
  assert.doesNotMatch(classified.sanitised, /db\.example\.com/);
  assert.match(classified.sanitised, /<path>/);
  assert.match(classified.sanitised, /HF_API_KEY=<redacted>/);
  assert.match(classified.sanitised, /postgres:\/\/<redacted>/);
});
