import { ValidationError } from '../errors.js';

/**
 * Bounded PostgreSQL wait policy for the backfill / chunk-replacement protocol.
 *
 * Every backfill transaction is short and deterministic: provider network calls
 * happen *outside* the transaction, so a transaction only ever performs a few
 * indexed reads/writes plus a document row lock. There is therefore no reason to
 * ever wait unbounded on a lock or a statement.
 *
 * Defaults (conservative, chosen for short DB-only transactions):
 *   * `lock_timeout`                  = 5s
 *       The document row lock is only ever held for the duration of a short
 *       write. If it cannot be acquired in 5s the holder is almost certainly wedged
 *       (for example idle-in-transaction), so failing fast beats holding a pooled
 *       connection. The SQL-level `idle_in_transaction_session_timeout` also clears
 *       such a holder.
 *   * `statement_timeout`             = 30s
 *       The longest statement here is a handful of row upserts; 30s is orders of
 *       magnitude above a healthy run and still bounds a runaway statement.
 *   * `idle_in_transaction_session_timeout` = 30s
 *       A transaction that sits idle for 30s is a bug in this protocol (all
 *       network I/O is outside transactions). It reclaims the connection instead
 *       of leaking a held document lock.
 *
 * Hard upper bounds exist so callers cannot set an effectively-infinite value by
 * accident, and so a test can still drive a tiny (but valid) timeout.
 *
 * `SET LOCAL` is used exclusively, so these values never leak past COMMIT/ROLLBACK
 * onto the pooled connection for the next borrower.
 */

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export const MAX_LOCK_TIMEOUT_MS = 60_000;
export const MAX_STATEMENT_TIMEOUT_MS = 300_000;
export const MAX_IDLE_IN_TRANSACTION_TIMEOUT_MS = 300_000;

export const DEFAULT_TRANSACTION_TIMEOUTS = Object.freeze({
  lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
  statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
  idleInTransactionTimeoutMs: DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS
});

function assertTimeout(value, name, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new ValidationError(
      `"${name}" must be an integer number of milliseconds between 0 and ${maximum} (got ${value}).`
    );
  }

  return value;
}

/**
 * Validate and normalise a partial timeout override.
 *
 * `null`/`undefined` fall back to the documented default; `0` explicitly disables
 * the corresponding limit. Every value is clamped to its hard upper bound by
 * validation (not silently truncated).
 */
export function resolveTransactionTimeouts({
  lockTimeoutMs,
  statementTimeoutMs,
  idleInTransactionTimeoutMs,
  ...rest
} = {}) {
  if (Object.keys(rest).length > 0) {
    throw new ValidationError(`Unknown transaction timeout option: ${Object.keys(rest)[0]}.`);
  }

  const lock = lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const statement = statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const idle = idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS;

  return Object.freeze({
    lockTimeoutMs: assertTimeout(lock, 'lockTimeoutMs', MAX_LOCK_TIMEOUT_MS),
    statementTimeoutMs: assertTimeout(statement, 'statementTimeoutMs', MAX_STATEMENT_TIMEOUT_MS),
    idleInTransactionTimeoutMs: assertTimeout(idle, 'idleInTransactionTimeoutMs', MAX_IDLE_IN_TRANSACTION_TIMEOUT_MS)
  });
}

/**
 * Apply the limits with `SET LOCAL` inside an already-open transaction.
 *
 * Must be called immediately after `BEGIN` and *before* any lock acquisition or
 * blocking statement, so the very first `FOR UPDATE` is already bounded.
 *
 * `SET` does not accept bind parameters, so the (already validated, integer) millisecond
 * values are inlined. No caller-controlled string ever reaches the SQL text.
 */
export async function applyTransactionTimeouts(client, timeouts = DEFAULT_TRANSACTION_TIMEOUTS) {
  if (!client || typeof client.query !== 'function') {
    throw new ValidationError('A database client is required to configure transaction timeouts.');
  }

  const resolved = resolveTransactionTimeouts(timeouts);

  await client.query(`SET LOCAL lock_timeout = '${resolved.lockTimeoutMs}ms'`);
  await client.query(`SET LOCAL statement_timeout = '${resolved.statementTimeoutMs}ms'`);
  await client.query(
    `SET LOCAL idle_in_transaction_session_timeout = '${resolved.idleInTransactionTimeoutMs}ms'`
  );

  return resolved;
}
