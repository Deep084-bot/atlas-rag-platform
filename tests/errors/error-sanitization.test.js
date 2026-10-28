import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyError,
  DatabaseError,
  ProviderError,
  ValidationError
} from '../../server/errors.js';

test('provider errors keep their operational category and status after sanitization', () => {
  const classified = classifyError(new ProviderError(
    'request failed at /Users/alice/.cache/atlas with HF_API_KEY=sk-live-secret',
    { provider: 'local', statusCode: 503 }
  ));

  assert.equal(classified.category, 'provider');
  assert.equal(classified.statusCode, 503);
  assert.match(classified.message, /request failed/);
  assert.doesNotMatch(classified.message, /\/Users\/alice/);
  assert.doesNotMatch(classified.message, /sk-live-secret/);
});

test('unexpected errors remain internal failures without echoing raw diagnostics', () => {
  const classified = classifyError(new Error('crashed reading /Users/alice/private.txt'));

  assert.equal(classified.category, 'internal');
  assert.equal(classified.statusCode, 500);
  assert.doesNotMatch(classified.message, /\/Users\/alice/);
});

test('database and validation failures retain distinct classifications', () => {
  assert.deepEqual(classifyError(new DatabaseError('connection lost')), {
    category: 'database',
    statusCode: 503,
    message: 'Database operation failed.'
  });
  assert.deepEqual(classifyError(new ValidationError('invalid limit')), {
    category: 'validation',
    statusCode: 400,
    message: 'invalid limit'
  });
});
