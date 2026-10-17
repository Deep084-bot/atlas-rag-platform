import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_LOCK_TIMEOUT_MS,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  MAX_LOCK_TIMEOUT_MS,
  MAX_STATEMENT_TIMEOUT_MS,
  applyTransactionTimeouts,
  resolveTransactionTimeouts
} from '../../server/db/transactionTimeouts.js';
import { ValidationError } from '../../server/errors.js';

test('resolveTransactionTimeouts falls back to the documented defaults', () => {
  const resolved = resolveTransactionTimeouts();

  assert.deepEqual(resolved, {
    lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
    statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS
  });
  assert.ok(Object.isFrozen(resolved));
});

test('resolveTransactionTimeouts honours explicit overrides including 0 (disabled)', () => {
  const resolved = resolveTransactionTimeouts({ lockTimeoutMs: 0, statementTimeoutMs: 1234 });

  assert.equal(resolved.lockTimeoutMs, 0);
  assert.equal(resolved.statementTimeoutMs, 1234);
  assert.equal(resolved.idleInTransactionTimeoutMs, DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS);
});

test('resolveTransactionTimeouts rejects non-integers, negatives, and over-limit values', () => {
  assert.throws(() => resolveTransactionTimeouts({ lockTimeoutMs: -1 }), ValidationError);
  assert.throws(() => resolveTransactionTimeouts({ lockTimeoutMs: 1.5 }), ValidationError);
  assert.throws(() => resolveTransactionTimeouts({ lockTimeoutMs: '5000' }), ValidationError);
  assert.throws(() => resolveTransactionTimeouts({ lockTimeoutMs: MAX_LOCK_TIMEOUT_MS + 1 }), ValidationError);
  assert.throws(() => resolveTransactionTimeouts({ statementTimeoutMs: MAX_STATEMENT_TIMEOUT_MS + 1 }), ValidationError);
  assert.throws(() => resolveTransactionTimeouts({ lockTimeoutMs: 5_000, nonsense: true }), ValidationError);
});

test('applyTransactionTimeouts issues SET LOCAL for each limit', async () => {
  const statements = [];
  const client = { async query(sql) { statements.push(sql); return { rows: [] }; } };

  await applyTransactionTimeouts(client);

  assert.deepEqual(statements, [
    `SET LOCAL lock_timeout = '${DEFAULT_LOCK_TIMEOUT_MS}ms'`,
    `SET LOCAL statement_timeout = '${DEFAULT_STATEMENT_TIMEOUT_MS}ms'`,
    `SET LOCAL idle_in_transaction_session_timeout = '${DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS}ms'`
  ]);
});

test('applyTransactionTimeouts only ever inlines validated integers', async () => {
  const statements = [];
  const client = { async query(sql) { statements.push(sql); return { rows: [] }; } };

  await applyTransactionTimeouts(client, { lockTimeoutMs: 250 });

  assert.equal(statements[0], "SET LOCAL lock_timeout = '250ms'");
});

test('applyTransactionTimeouts requires a client with query()', async () => {
  await assert.rejects(() => applyTransactionTimeouts({}), ValidationError);
});
