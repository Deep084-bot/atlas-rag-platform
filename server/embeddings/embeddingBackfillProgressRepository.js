import { DatabaseError, ValidationError } from '../errors.js';

export const BACKFILL_STATUSES = Object.freeze(['pending', 'in_progress', 'completed', 'failed']);

const RESUMABLE_STATUSES = Object.freeze(['pending', 'in_progress', 'failed']);

/**
 * Default lease for a claimed document.
 *
 * Chosen so it comfortably exceeds the worst-case cost of a single bounded
 * provider batch: Voyage's 15s timeout × (2 retries + 1) attempts = ~45s of
 * request time plus up to two Retry-After waits (≤60s each) ≈ 165s max. 5 minutes
 * bounds a crashed holder without leaving the document permanently unclaimable,
 * and the runner renews the lease before every provider batch it is about to spend.
 */
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
export const MAX_LEASE_MS = 30 * 60 * 1000;

function resolveQueryable(pool, client) {
  return client ?? pool;
}

function assertCount(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`"${field}" must be a non-negative integer.`);
  }
}

function assertKey(spaceId, documentId) {
  if (!spaceId || typeof spaceId !== 'string') {
    throw new ValidationError('A space id is required to track backfill progress.');
  }

  if (!documentId) {
    throw new ValidationError('A document id is required to track backfill progress.');
  }
}

function assertAttempt(attempt) {
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new ValidationError('"attempt" fencing token must be a positive integer.');
  }
}

function assertLease(leaseMs) {
  if (!Number.isInteger(leaseMs) || leaseMs <= 0 || leaseMs > MAX_LEASE_MS) {
    throw new ValidationError(`"leaseMs" must be an integer between 1 and ${MAX_LEASE_MS}.`);
  }
}

/**
 * Persistence for `embedding_backfill_progress`.
 *
 * A row is keyed by `(space_id, document_id)` and moves through
 * pending -> in_progress -> completed | failed.
 *
 * `claimDocument` is the mutual-exclusion primitive: it takes a lease by
 * atomically moving a claimable row (`pending`/`failed`, or an `in_progress`
 * row whose lease expired) to `in_progress` and increments `attempts`. `attempts`
 * is therefore both the retry counter and the fencing token — `renewClaim` and
 * every subsequent write present it and silently refuse to act when it does not
 * match, which is what prevents a stalled worker from clobbering a newer one.
 * `updated_at` is the lease heartbeat.
 *
 * `markInProgress` predates the lease and remains available for callers that
 * only need the original guarded transition; new claim-based code should use
 * `claimDocument`. All methods accept an optional `{ client }` so the runner can
 * update progress in the same transaction as the chunk upserts.
 */
export class EmbeddingBackfillProgressRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async markInProgress(
    { spaceId, documentId, expectedChunkCount, completedChunkCount = 0, startedAt = null },
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertCount(expectedChunkCount, 'expectedChunkCount');
    assertCount(completedChunkCount, 'completedChunkCount');

    const result = await queryable.query(
      `
        INSERT INTO embedding_backfill_progress (
          space_id, document_id, status, expected_chunk_count, completed_chunk_count,
          token_count, tokens_available, attempts, last_error, started_at, completed_at, updated_at
        )
        VALUES ($1, $2, 'in_progress', $3, $4, 0, false, 1, NULL, $5, NULL, now())
        ON CONFLICT (space_id, document_id)
        DO UPDATE SET
          status = 'in_progress',
          expected_chunk_count = EXCLUDED.expected_chunk_count,
          completed_chunk_count = EXCLUDED.completed_chunk_count,
          token_count = 0,
          tokens_available = false,
          attempts = embedding_backfill_progress.attempts + 1,
          last_error = NULL,
          started_at = COALESCE(embedding_backfill_progress.started_at, EXCLUDED.started_at),
          completed_at = NULL,
          updated_at = now()
        WHERE embedding_backfill_progress.status IN ('pending', 'in_progress', 'failed')
        RETURNING *
      `,
      [spaceId, documentId, expectedChunkCount, completedChunkCount, startedAt]
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  /**
   * Atomically claim a document for backfill, returning the row (with its new
   * `attempts` fencing token) or `null` when the claim was refused.
   *
   * A claim succeeds exactly when:
   *   * no row exists yet (fresh insert), or
   *   * the row is `pending`/`failed`, or
   *   * the row is `in_progress` but its lease has expired
   *     (`updated_at < now() - leaseMs`).
   *
   * A `completed` row is never reclaimable, and a live `in_progress` row owned by
   * another worker is left untouched — so two workers racing on the same document
   * cannot both proceed to call the provider. `attempts` is incremented on every
   * successful claim and is the fence every subsequent write must present.
   */
  async claimDocument(
    { spaceId, documentId, expectedChunkCount, completedChunkCount = 0, leaseMs = DEFAULT_LEASE_MS, startedAt = null },
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertCount(expectedChunkCount, 'expectedChunkCount');
    assertCount(completedChunkCount, 'completedChunkCount');
    assertLease(leaseMs);

    const result = await queryable.query(
      `
        INSERT INTO embedding_backfill_progress (
          space_id, document_id, status, expected_chunk_count, completed_chunk_count,
          token_count, tokens_available, attempts, last_error, started_at, completed_at, updated_at
        )
        VALUES ($1, $2, 'in_progress', $3, $4, 0, false, 1, NULL, $5, NULL, now())
        ON CONFLICT (space_id, document_id)
        DO UPDATE SET
          status = 'in_progress',
          expected_chunk_count = EXCLUDED.expected_chunk_count,
          completed_chunk_count = EXCLUDED.completed_chunk_count,
          token_count = 0,
          tokens_available = false,
          attempts = embedding_backfill_progress.attempts + 1,
          last_error = NULL,
          completed_at = NULL,
          updated_at = now()
        WHERE embedding_backfill_progress.status IN ('pending', 'failed')
           OR (
             embedding_backfill_progress.status = 'in_progress'
             AND embedding_backfill_progress.updated_at < now() - ($6 * interval '1 millisecond')
           )
        RETURNING *
      `,
      [spaceId, documentId, expectedChunkCount, completedChunkCount, startedAt, leaseMs]
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  /**
   * Extend the lease for the current `attempt`, provided this worker still owns it.
   *
   * Called immediately before a provider batch is dispatched so a worker that has
   * been fenced out (a newer `attempts` took over) stops *before* spending tokens.
   * Returns the refreshed row, or `null` when ownership has been lost.
   */
  async renewClaim({ spaceId, documentId, attempt }, { client = null } = {}) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertAttempt(attempt);

    const result = await queryable.query(
      `
        UPDATE embedding_backfill_progress
        SET updated_at = now()
        WHERE space_id = $1
          AND document_id = $2
          AND status = 'in_progress'
          AND attempts = $3
        RETURNING *
      `,
      [spaceId, documentId, attempt]
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async updateProgressCounts(
    { spaceId, documentId, completedChunkCount, tokenCount = 0, tokensAvailable = false, attempt = null },
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertCount(completedChunkCount, 'completedChunkCount');
    assertCount(tokenCount, 'tokenCount');

    const params = [spaceId, documentId, completedChunkCount, tokenCount, Boolean(tokensAvailable)];
    let fence = '';

    if (attempt !== null && attempt !== undefined) {
      assertAttempt(attempt);
      params.push(attempt);
      fence = `\n          AND attempts = $${params.length}`;
    }

    const result = await queryable.query(
      `
        UPDATE embedding_backfill_progress
        SET completed_chunk_count = $3,
            token_count = $4,
            tokens_available = $5,
            updated_at = now()
        WHERE space_id = $1
          AND document_id = $2
          AND status IN ('in_progress')${fence}
        RETURNING *
      `,
      params
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async markCompleted(
    {
      spaceId,
      documentId,
      expectedChunkCount,
      completedChunkCount,
      tokenCount = 0,
      tokensAvailable = false,
      completedAt = null,
      attempt = null
    },
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertCount(expectedChunkCount, 'expectedChunkCount');
    assertCount(completedChunkCount, 'completedChunkCount');
    assertCount(tokenCount, 'tokenCount');

    const params = [
      spaceId,
      documentId,
      expectedChunkCount,
      completedChunkCount,
      tokenCount,
      Boolean(tokensAvailable),
      completedAt
    ];
    let fence = '';

    if (attempt !== null && attempt !== undefined) {
      assertAttempt(attempt);
      params.push(attempt);
      // Inside ON CONFLICT ... DO UPDATE the target table is in scope twice, so
      // the fence column must be fully qualified to avoid ambiguity.
      fence = `\n          AND embedding_backfill_progress.attempts = $${params.length}`;
    }

    const result = await queryable.query(
      `
        INSERT INTO embedding_backfill_progress (
          space_id, document_id, status, expected_chunk_count, completed_chunk_count,
          token_count, tokens_available, attempts, last_error, started_at, completed_at, updated_at
        )
        VALUES ($1, $2, 'completed', $3, $4, $5, $6, 0, NULL, $7, now(), now())
        ON CONFLICT (space_id, document_id)
        DO UPDATE SET
          status = 'completed',
          expected_chunk_count = EXCLUDED.expected_chunk_count,
          completed_chunk_count = EXCLUDED.completed_chunk_count,
          token_count = EXCLUDED.token_count,
          tokens_available = EXCLUDED.tokens_available,
          last_error = NULL,
          completed_at = EXCLUDED.completed_at,
          updated_at = now()
        WHERE embedding_backfill_progress.status IN ('in_progress', 'pending', 'failed')${fence}
        RETURNING *
      `,
      params
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async markFailed(
    {
      spaceId,
      documentId,
      lastError = null,
      completedChunkCount = 0,
      tokenCount = 0,
      tokensAvailable = false,
      attempt = null
    },
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);
    assertCount(completedChunkCount, 'completedChunkCount');
    assertCount(tokenCount, 'tokenCount');

    const params = [spaceId, documentId, lastError, completedChunkCount, tokenCount, Boolean(tokensAvailable)];
    let fence = '';

    if (attempt !== null && attempt !== undefined) {
      assertAttempt(attempt);
      params.push(attempt);
      fence = `\n          AND attempts = $${params.length}`;
    }

    const result = await queryable.query(
      `
        UPDATE embedding_backfill_progress
        SET status = 'failed',
            last_error = $3,
            completed_chunk_count = $4,
            token_count = $5,
            tokens_available = $6,
            updated_at = now()
        WHERE space_id = $1
          AND document_id = $2
          AND status IN ('in_progress', 'pending', 'failed')${fence}
        RETURNING *
      `,
      params
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async getProgress(spaceId, documentId, { client = null } = {}) {
    const queryable = this.queryable(client);
    assertKey(spaceId, documentId);

    const result = await queryable.query(
      `
        SELECT *
        FROM embedding_backfill_progress
        WHERE space_id = $1
          AND document_id = $2
      `,
      [spaceId, documentId]
    );

    return result.rows[0] ? this.toRecord(result.rows[0]) : null;
  }

  async listResumable(
    spaceId,
    { limit = 100, statuses = RESUMABLE_STATUSES } = {},
    { client = null } = {}
  ) {
    const queryable = this.queryable(client);

    if (!spaceId || typeof spaceId !== 'string') {
      throw new ValidationError('A space id is required to list resumable backfill progress.');
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ValidationError('"limit" must be a positive integer.');
    }

    if (!Array.isArray(statuses) || statuses.length === 0) {
      throw new ValidationError('"statuses" must be a non-empty array.');
    }

    for (const status of statuses) {
      if (!BACKFILL_STATUSES.includes(status)) {
        throw new ValidationError(`Unknown backfill status "${status}".`);
      }
    }

    const result = await queryable.query(
      `
        SELECT *
        FROM embedding_backfill_progress
        WHERE space_id = $1
          AND status = ANY($3::text[])
        ORDER BY updated_at ASC
        LIMIT $2
      `,
      [spaceId, limit, statuses]
    );

    return result.rows.map((row) => this.toRecord(row));
  }

  queryable(client) {
    const queryable = resolveQueryable(this.pool, client);

    if (queryable == null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    return queryable;
  }

  toRecord(row) {
    return {
      spaceId: row.space_id,
      documentId: row.document_id,
      status: row.status,
      expectedChunkCount: Number(row.expected_chunk_count),
      completedChunkCount: Number(row.completed_chunk_count),
      tokenCount: Number(row.token_count),
      tokensAvailable: Boolean(row.tokens_available),
      attempts: Number(row.attempts),
      lastError: row.last_error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export { RESUMABLE_STATUSES };
