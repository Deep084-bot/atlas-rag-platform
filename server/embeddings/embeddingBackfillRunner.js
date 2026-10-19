import { DatabaseError, ProviderError, ValidationError } from '../errors.js';
import { applyTransactionTimeouts, DEFAULT_TRANSACTION_TIMEOUTS } from '../db/transactionTimeouts.js';
import { DEFAULT_LEASE_MS, MAX_LEASE_MS } from './embeddingBackfillProgressRepository.js';
import { computeEmbeddingL2Norm, isTableSpace } from './embeddingWriteTarget.js';
import { resolveDimensionsForService } from './embeddingSpaces.js';
import {
  DEFAULT_EMBEDDING_ELIGIBILITY_POLICY,
  assertEmbeddingEligibilityPolicy,
  evaluateEmbeddingEligibility
} from './embeddingEligibility.js';

const MAX_FAILURE_REASON_LENGTH = 500;
const MAX_CLAIM_RETRIES = 3;
const CLAIM_RETRY_BASE_DELAY_MS = 100;

const RETRYABLE_CLAIM_CATEGORIES = Object.freeze(['db_timeout', 'db_concurrency']);

/**
 * Sentinel returned by {@link readProgressSafely} when the progress row could
 * not be read. It is deliberately distinct from `null` (a genuinely missing row,
 * which means the chunk set was replaced) so a failed *read* is never mistaken
 * for a successful hand-off to another worker.
 */
const PROGRESS_READ_UNAVAILABLE = Symbol('progress-read-unavailable');

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeFailureReason(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = message.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();

  if (cleaned.length === 0) {
    return 'Embedding backfill failed.';
  }

  if (cleaned.length > MAX_FAILURE_REASON_LENGTH) {
    return `${cleaned.slice(0, MAX_FAILURE_REASON_LENGTH - 1).trimEnd()}…`;
  }

  return cleaned;
}

/**
 * Thrown when a worker discovers it lost the document lease mid-flight. Its
 * message is deliberately generic (no chunk/document content) and it is never
 * retried: another worker now owns the document.
 */
export class OwnershipLostError extends DatabaseError {
  constructor(message = 'Backfill ownership was lost before the attempt could finish.') {
    super(message);
    this.name = 'OwnershipLostError';
  }
}

/**
 * Bounded, sanitised classification of a backfill failure.
 *
 * Categories (mutually exclusive, all derived only from stable, non-sensitive
 * signals — error class, HTTP status, PostgreSQL SQLSTATE):
 *
 *   `rate_limit`      transient provider throttling (HTTP 429) — safe to retry
 *   `provider_transient` transient provider/network failure (5xx, timeouts) — safe to retry
 *   `provider_permanent` authentication/configuration failure (401/402/403) — do not retry
 *   `invalid_input`   rejected request body or vector validation failure — do not retry
 *   `db_timeout`      PostgreSQL `lock_timeout` / `statement_timeout` — safe to retry
 *   `db_concurrency`  PostgreSQL serialization/aborted-transient connection errors — safe to retry
 *   `state_changed`   document or chunk set changed underneath the attempt — safe to retry later
 *   `ownership_lost`  this worker no longer owns the document (lease taken over)
 *   `unknown`         anything unrecognised — never treated as success
 *
 * The returned `sanitised` message has control characters collapsed and is
 * never allowed to carry API keys, credentials, or raw provider bodies.
 */
export function classifyBackfillError(error) {
  const sanitised = sanitizeFailureReason(error);

  if (error instanceof ValidationError) {
    return { category: 'invalid_input', retryable: false, sanitised };
  }

  if (error instanceof OwnershipLostError) {
    return { category: 'ownership_lost', retryable: false, sanitised };
  }

  if (error instanceof ProviderError) {
    const status = Number.isFinite(error.statusCode) ? error.statusCode : null;

    if (status === 429) {
      return { category: 'rate_limit', retryable: true, sanitised };
    }

    if (status === 401 || status === 402 || status === 403) {
      return { category: 'provider_permanent', retryable: false, sanitised };
    }

    if (status === 400) {
      return { category: 'invalid_input', retryable: false, sanitised };
    }

    if (status !== null && status >= 500) {
      return { category: 'provider_transient', retryable: true, sanitised };
    }

    if (status === 504 || status === 503) {
      return { category: 'provider_transient', retryable: true, sanitised };
    }

    return { category: 'provider_transient', retryable: error.retryable === true, sanitised };
  }

  const sqlstate = typeof error?.code === 'string' ? error.code : null;

  if (sqlstate === '55P03' || sqlstate === '57014') {
    return { category: 'db_timeout', retryable: true, sanitised };
  }

  if (sqlstate === '40001' || sqlstate === '40P01' || sqlstate === '53300' || sqlstate === '53400') {
    return { category: 'db_concurrency', retryable: true, sanitised };
  }

  if (
    error instanceof DatabaseError
    || (error instanceof Error && /deleted before completion|still has \d+ chunk|no longer exists|refusing to/i.test(error.message))
  ) {
    return { category: 'state_changed', retryable: true, sanitised };
  }

  return { category: 'unknown', retryable: false, sanitised };
}

function assertEmbeddingBatch(embeddings, expectedCount, dimensions) {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new ProviderError('Embedding provider returned an unexpected number of embeddings.', {
      provider: 'Embedding provider',
      statusCode: 502
    });
  }

  for (const embedding of embeddings) {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new ProviderError('Embedding provider returned an empty embedding.', {
        provider: 'Embedding provider',
        statusCode: 502
      });
    }

    if (Number.isFinite(dimensions) && embedding.length !== dimensions) {
      throw new ProviderError('Embedding provider returned embeddings with the wrong dimensions.', {
        provider: 'Embedding provider',
        statusCode: 502
      });
    }
  }
}

/**
 * Run `fn` inside a single database transaction on a pooled connection.
 *
 * Embedding API calls must happen *before* the transaction; this helper only
 * wraps the resulting writes so a batch's chunk upserts and its progress update
 * commit atomically.
 *
 * Bounded waits are applied with `SET LOCAL` immediately after `BEGIN` and before
 * the body runs, so the very first lock acquisition is already limited.
 */
export async function withTransaction(pool, fn, transactionTimeouts = DEFAULT_TRANSACTION_TIMEOUTS) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new DatabaseError('A connection pool is required to run a backfill transaction.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await applyTransactionTimeouts(client, transactionTimeouts);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback is best-effort; the original error is what matters.
    }

    throw error;
  } finally {
    if (typeof client.release === 'function') {
      client.release();
    }
  }
}

/**
 * Resumable backfill runner for a table-backed (Voyage) embedding space.
 *
 * Behaviour:
 *   * A document must be *claimed* under a lease before any provider call. The
 *     claim is a single atomic row upsert, so two concurrent workers cannot both
 *     start, and a fenced-out worker discovers it lost ownership before spending
 *     tokens (`renewClaim` runs immediately before every provider batch).
 *   * The `attempts` column doubles as a fencing token: every progress write
 *     carries it, so a stale worker cannot overwrite a newer claim.
 *   * Only chunks missing a `chunk_embeddings` row for the space are embedded, so
 *     an interrupted run resumes without re-embedding stored chunks.
 *   * Each batch's chunk upserts and its progress update commit in one
 *     transaction; the embedding API call happens before the transaction opens.
 *     A fenced-out batch rolls back rather than leaving embeddings behind.
 *   * Progress rows move pending -> in_progress -> completed | failed. A crash
 *     leaves the row in_progress, which the next run resumes after the lease
 *     expires.
 *   * `token_count` keeps every token the provider actually reported; when any
 *     request omits usage the total stays `tokens_available = false` instead of
 *     being silently zeroed.
 *   * Every transaction uses bounded `lock_timeout`, `statement_timeout` and
 *     `idle_in_transaction_session_timeout` waits.
 *   * Document eligibility (`eligibilityPolicy`, default `general`) is verified
 *     at three points — an early read, again under the document row lock before
 *     the claim, and again under the same lock immediately before every provider
 *     batch. A document that is not in an allowed status yields an explicit
 *     `ineligible` result and never reaches the provider; a status change
 *     mid-flight stops the run before the next batch is dispatched.
 *
 * The runner never contacts a provider on its own and never falls back to the
 * legacy store: a non-table space fails construction, and every write is scoped
 * to `chunk_embeddings` via `space.id`.
 */
export function createEmbeddingBackfillRunner({
  pool = null,
  documentsRepository,
  embeddingRepository,
  chunkEmbeddingRepository,
  embeddingBackfillProgressRepository,
  embeddingProvider,
  space,
  batchSize = 8,
  dimensions,
  leaseMs = DEFAULT_LEASE_MS,
  transactionTimeouts = DEFAULT_TRANSACTION_TIMEOUTS,
  eligibilityPolicy = DEFAULT_EMBEDDING_ELIGIBILITY_POLICY,
  logger = console,
  now = () => new Date(),
  runInTransaction = null
} = {}) {
  if (!space || !isTableSpace(space)) {
    throw new ValidationError('The embedding backfill runner requires a table-backed (Voyage) space.');
  }

  const resolvedEligibilityPolicy = assertEmbeddingEligibilityPolicy(eligibilityPolicy);

  if (!documentsRepository || !embeddingRepository || !chunkEmbeddingRepository || !embeddingBackfillProgressRepository) {
    throw new ValidationError('The embedding backfill runner requires all repositories.');
  }

  if (typeof documentsRepository.lockForUpdate !== 'function') {
    throw new ValidationError('The embedding backfill runner requires a documents repository that can take the document row lock.');
  }

  if (
    !embeddingProvider
    || (typeof embeddingProvider.embedMany !== 'function' && typeof embeddingProvider.embedManyWithUsage !== 'function')
  ) {
    throw new ValidationError('The embedding backfill runner requires an embedding provider.');
  }

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new ValidationError('"batchSize" must be a positive integer.');
  }

  if (!Number.isInteger(leaseMs) || leaseMs <= 0 || leaseMs > MAX_LEASE_MS) {
    throw new ValidationError(`"leaseMs" must be an integer between 1 and ${MAX_LEASE_MS} milliseconds.`);
  }

  const embeddingDimensions = resolveDimensionsForService({ dimensions, provider: embeddingProvider, space });
  const execute = runInTransaction ?? ((fn) => withTransaction(pool, fn, transactionTimeouts));
  const spaceId = space.id;

  /**
   * Build the explicit, non-success result for a document the active policy may
   * not embed. `reason` is a stable code (see `EMBEDDING_INELIGIBLE_REASONS`) so
   * callers can branch without parsing prose, and `documentStatus` records what
   * was actually observed.
   */
  function ineligibleResult(documentId, { reason, documentStatus = null, embeddedChunks = 0, totalChunks = 0 }) {
    return {
      documentId,
      spaceId,
      status: 'ineligible',
      reason,
      documentStatus: documentStatus ?? null,
      embeddedChunks,
      totalChunks
    };
  }

  /**
   * Acquire the document lease, retrying only the small set of errors that are
   * genuinely safe to retry (lock/statement timeout, serialization failure,
   * transient connection loss) and only a bounded number of times with capped
   * exponential backoff. Anything else — including a refused claim — surfaces
   * immediately and is never hidden behind a retry loop.
   *
   * The claim runs in the *same* transaction as a document-row lock and a fresh
   * eligibility read, so a status change that lands between the early check and
   * the claim is caught here (and, if the document is gone, reported as `missing`
   * rather than inserting an orphan progress row against a deleted document).
   */
  async function claimWithRetry(documentId, claimPayload) {
    for (let attemptIndex = 0; attemptIndex < MAX_CLAIM_RETRIES; attemptIndex += 1) {
      try {
        return await execute(async (client) => {
          const locked = await documentsRepository.lockForUpdate(documentId, { client });

          if (!locked) {
            return { outcome: 'missing' };
          }

          const document = await documentsRepository.getDocumentById(documentId, { client });
          const eligibility = evaluateEmbeddingEligibility(document, resolvedEligibilityPolicy);

          if (!eligibility.eligible) {
            return {
              outcome: 'ineligible',
              reason: eligibility.reason,
              documentStatus: eligibility.documentStatus
            };
          }

          const claim = await embeddingBackfillProgressRepository.claimDocument(claimPayload, { client });
          return { outcome: 'claimed', claim };
        });
      } catch (error) {
        const { category, retryable } = classifyBackfillError(error);
        const isLastAttempt = attemptIndex === MAX_CLAIM_RETRIES - 1;

        if (isLastAttempt || !retryable || !RETRYABLE_CLAIM_CATEGORIES.includes(category)) {
          throw error;
        }

        await delay(CLAIM_RETRY_BASE_DELAY_MS * 2 ** attemptIndex);
      }
    }

    return { outcome: 'missing' };
  }

  async function embedBatch(texts) {
    if (typeof embeddingProvider.embedManyWithUsage === 'function') {
      const { embeddings, usage, usageAvailable } = await embeddingProvider.embedManyWithUsage(texts);

      if (usageAvailable && usage && Number.isFinite(usage.totalTokens)) {
        return { embeddings, usageAvailable: true, totalTokens: Number(usage.totalTokens) };
      }

      return { embeddings, usageAvailable: false, totalTokens: 0 };
    }

    const embeddings = await embeddingProvider.embedMany(texts);
    return { embeddings, usageAvailable: false, totalTokens: 0 };
  }

  async function inspect(documentId) {
    const document = await documentsRepository.getDocumentById(documentId);

    if (!document) {
      return null;
    }

    const totalChunks = await embeddingRepository.countTotalChunks(documentId);
    const missingChunkIds = await chunkEmbeddingRepository.findChunkIdsMissingEmbedding(documentId, spaceId);

    return {
      documentId,
      document,
      documentStatus: typeof document.status === 'string' ? document.status : null,
      totalChunks,
      missingChunkIds,
      embeddedChunks: Math.max(totalChunks - missingChunkIds.length, 0)
    };
  }

  async function verifyAndComplete(documentId, client, { tokenCount, tokensAvailable, attempt = null }) {
    // Serialize with any concurrent chunk-set mutation for this document by
    // holding the document row lock across verification and completion.
    const locked = await documentsRepository.lockForUpdate(documentId, { client });

    if (!locked) {
      throw new DatabaseError(
        `Document ${documentId} was deleted before completion could be recorded; refusing to mark it completed.`
      );
    }

    const verification = await chunkEmbeddingRepository.isDocumentFullyEmbedded(documentId, spaceId, { client });

    if (!verification.complete) {
      throw new DatabaseError(
        `Document ${documentId} still has ${verification.missingChunks} chunk(s) without a ${spaceId} embedding; refusing to mark it completed.`
      );
    }

    const completion = await embeddingBackfillProgressRepository.markCompleted({
      spaceId,
      documentId,
      expectedChunkCount: verification.totalChunks,
      completedChunkCount: verification.embeddedChunks,
      tokenCount,
      tokensAvailable,
      attempt,
      completedAt: now()
    }, { client });

    if (completion === null) {
      const current = await embeddingBackfillProgressRepository.getProgress(spaceId, documentId, { client });

      if (current && current.status === 'completed') {
        // Someone (including a previous run of us) already recorded completion
        // for this same verified state; idempotently treat it as ours.
        return verification;
      }

      // With a fence present, a non-completed row means another worker claimed
      // this document — never report success for a lease we no longer hold.
      if (attempt !== null) {
        throw new OwnershipLostError();
      }

      throw new DatabaseError(
        `Document ${documentId} completion could not be recorded (current progress status "${current?.status ?? 'missing'}").`
      );
    }

    return verification;
  }

  /**
   * Claim the document under a lease, then (and only then) call the provider.
   *
   * Ordering matters: the lease is taken before the first token is spent and
   * renewed immediately before every subsequent provider batch, so a worker that
   * has been fenced out stops *before* the API call rather than after wasting it.
   */
  async function backfillDocument(documentId) {
    const inspection = await inspect(documentId);

    if (!inspection) {
      return { documentId, spaceId, status: 'missing', embeddedChunks: 0, totalChunks: 0 };
    }

    // Early eligibility read: reject an ineligible document before any chunk
    // scan or provider dispatch. This is re-checked under the document row lock
    // before the claim and before every batch, so a status change mid-flight is
    // still caught; this first check just avoids doing useless work.
    const earlyEligibility = evaluateEmbeddingEligibility(inspection.document, resolvedEligibilityPolicy);

    if (!earlyEligibility.eligible) {
      return ineligibleResult(documentId, {
        reason: earlyEligibility.reason,
        documentStatus: earlyEligibility.documentStatus,
        embeddedChunks: inspection.embeddedChunks,
        totalChunks: inspection.totalChunks
      });
    }

    const { totalChunks, missingChunkIds, embeddedChunks } = inspection;
    const missingSet = new Set(missingChunkIds);

    let completedChunkCount = embeddedChunks;
    let tokenTotal = 0;
    let allUsageAvailable = true;
    let usageSeen = false;
    // Fencing token for the current lease; null until the claim succeeds.
    let attempt = null;

    // A known partial token total is preserved (with `tokensAvailable = false`)
    // rather than thrown away: the reported number stays truthful to what the
    // provider actually told us, and the flag marks it as incomplete.
    const finalTokenCount = () => (usageSeen ? tokenTotal : 0);
    const finalTokensAvailable = () => usageSeen && allUsageAvailable;

    try {
      if (totalChunks === 0 || missingChunkIds.length === 0) {
        const verification = await execute((client) => verifyAndComplete(documentId, client, {
          tokenCount: 0,
          tokensAvailable: false
        }));

        return { documentId, spaceId, status: 'completed', embeddedChunks: verification.embeddedChunks, totalChunks: verification.totalChunks };
      }

      const claimOutcome = await claimWithRetry(documentId, {
        spaceId,
        documentId,
        expectedChunkCount: totalChunks,
        completedChunkCount: embeddedChunks,
        leaseMs,
        startedAt: now()
      });

      if (claimOutcome.outcome === 'missing') {
        return { documentId, spaceId, status: 'missing', embeddedChunks, totalChunks };
      }

      if (claimOutcome.outcome === 'ineligible') {
        return ineligibleResult(documentId, {
          reason: claimOutcome.reason,
          documentStatus: claimOutcome.documentStatus,
          embeddedChunks,
          totalChunks
        });
      }

      const claim = claimOutcome.claim;

      if (claim === null) {
        // Either another worker holds a live lease (do not spend tokens), or the
        // row is already completed.
        const current = await embeddingBackfillProgressRepository.getProgress(spaceId, documentId);

        if (current && current.status === 'completed') {
          const verification = await execute((client) => verifyAndComplete(documentId, client, {
            tokenCount: 0,
            tokensAvailable: false
          }));

          return { documentId, spaceId, status: 'completed', embeddedChunks: verification.embeddedChunks, totalChunks: verification.totalChunks };
        }

        return {
          documentId,
          spaceId,
          status: 'skipped',
          embeddedChunks,
          totalChunks,
          reason: 'The document is already being backfilled by another worker.'
        };
      }

      attempt = claim.attempts;

      const chunks = await embeddingRepository.getChunksForDocument(documentId);
      const pending = chunks.filter((chunk) => missingSet.has(chunk.id));

      for (let index = 0; index < pending.length; index += batchSize) {
        const batch = pending.slice(index, index + batchSize);

        // Gate the batch: under the document row lock, revalidate that the
        // document still exists and is still eligible, then renew the lease —
        // all before spending any tokens. A document replaced or made ineligible
        // mid-flight is caught here, before the next provider call.
        const batchGate = await execute(async (client) => {
          const locked = await documentsRepository.lockForUpdate(documentId, { client });

          if (!locked) {
            return { outcome: 'missing' };
          }

          const document = await documentsRepository.getDocumentById(documentId, { client });
          const eligibility = evaluateEmbeddingEligibility(document, resolvedEligibilityPolicy);

          if (!eligibility.eligible) {
            return {
              outcome: 'ineligible',
              reason: eligibility.reason,
              documentStatus: eligibility.documentStatus
            };
          }

          // Renew the lease last: a null result means a newer claim took over,
          // so abort before dispatching the request.
          const renewed = await embeddingBackfillProgressRepository.renewClaim({
            spaceId,
            documentId,
            attempt
          }, { client });

          return renewed === null ? { outcome: 'ownership_lost' } : { outcome: 'renewed' };
        });

        if (batchGate.outcome === 'ownership_lost') {
          throw new OwnershipLostError();
        }

        if (batchGate.outcome === 'missing') {
          throw new DatabaseError(
            `Document ${documentId} was deleted before the next batch could be dispatched; refusing to continue.`
          );
        }

        if (batchGate.outcome === 'ineligible') {
          return ineligibleResult(documentId, {
            reason: batchGate.reason,
            documentStatus: batchGate.documentStatus,
            embeddedChunks: completedChunkCount,
            totalChunks
          });
        }

        const { embeddings, usageAvailable, totalTokens } = await embedBatch(batch.map((chunk) => chunk.content));

        assertEmbeddingBatch(embeddings, batch.length, embeddingDimensions);

        if (usageAvailable) {
          tokenTotal += totalTokens;
          usageSeen = true;
        } else {
          allUsageAvailable = false;
        }

        const nextCompletedChunkCount = completedChunkCount + batch.length;

        await execute(async (client) => {
          for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
            const embedding = embeddings[batchIndex];
            const persisted = await chunkEmbeddingRepository.upsertChunkEmbedding({
              chunkId: batch[batchIndex].id,
              spaceId,
              embedding,
              l2Norm: computeEmbeddingL2Norm(embedding, { dimensions: embeddingDimensions })
            }, { client });

            if (!persisted) {
              throw new DatabaseError(
                `Chunk ${batch[batchIndex].id} no longer exists; refusing to record a partial backfill.`
              );
            }
          }

          const updated = await embeddingBackfillProgressRepository.updateProgressCounts({
            spaceId,
            documentId,
            completedChunkCount: nextCompletedChunkCount,
            tokenCount: finalTokenCount(),
            tokensAvailable: finalTokensAvailable(),
            attempt
          }, { client });

          // Throwing inside the transaction rolls back this batch's chunk
          // upserts, so a fenced-out worker cannot leave embeddings behind.
          if (updated === null) {
            throw new OwnershipLostError();
          }
        });

        completedChunkCount = nextCompletedChunkCount;
      }

      const verification = await execute((client) => verifyAndComplete(documentId, client, {
        tokenCount: finalTokenCount(),
        tokensAvailable: finalTokensAvailable(),
        attempt
      }));

      return { documentId, spaceId, status: 'completed', embeddedChunks: verification.embeddedChunks, totalChunks: verification.totalChunks };
    } catch (error) {
      if (error instanceof OwnershipLostError) {
        // We no longer hold the lease. Distinguish a takeover (another worker
        // claimed the row) from the row disappearing entirely (a chunk-set
        // replacement deleted it): the former is a hand-off, the latter is a
        // state change the caller must know about.
        const current = await readProgressSafely(documentId);

        if (current === PROGRESS_READ_UNAVAILABLE) {
          // The lease was lost and we cannot read progress to find out why.
          // Fail closed rather than assuming a clean hand-off.
          return ownershipUnverifiedResult(documentId, { completedChunkCount, totalChunks });
        }

        if (current === null) {
          return {
            documentId,
            spaceId,
            status: 'failed',
            category: 'state_changed',
            retryable: true,
            embeddedChunks: completedChunkCount,
            totalChunks,
            error: 'The document chunk set changed during backfill; the attempt was abandoned.'
          };
        }

        return {
          documentId,
          spaceId,
          status: 'skipped',
          embeddedChunks: completedChunkCount,
          totalChunks,
          reason: 'The document lease was taken over before this attempt finished.'
        };
      }

      const classification = classifyBackfillError(error);
      const reason = classification.sanitised;

      try {
        const marked = await execute((client) => embeddingBackfillProgressRepository.markFailed({
          spaceId,
          documentId,
          lastError: reason,
          completedChunkCount,
          tokenCount: finalTokenCount(),
          tokensAvailable: finalTokensAvailable(),
          attempt
        }, { client }));

        if (marked === null && attempt !== null) {
          // The fenced write was refused. Either a newer claim owns the row
          // (a hand-off) or the row is gone (a replacement). Never clobber.
          const current = await readProgressSafely(documentId);

          if (current === PROGRESS_READ_UNAVAILABLE) {
            return ownershipUnverifiedResult(documentId, { completedChunkCount, totalChunks });
          }

          if (current === null) {
            return {
              documentId,
              spaceId,
              status: 'failed',
              category: 'state_changed',
              retryable: true,
              embeddedChunks: completedChunkCount,
              totalChunks,
              error: reason
            };
          }

          return {
            documentId,
            spaceId,
            status: 'skipped',
            embeddedChunks: completedChunkCount,
            totalChunks,
            reason: 'The document lease was taken over before this attempt could be recorded.'
          };
        }
      } catch (markError) {
        const markMessage = markError instanceof Error ? markError.message : 'unknown error';
        logger.error(`Failed to persist backfill failure for ${documentId}: ${markMessage}`);
      }

      return {
        documentId,
        spaceId,
        status: 'failed',
        category: classification.category,
        retryable: classification.retryable,
        embeddedChunks: completedChunkCount,
        totalChunks,
        error: reason
      };
    }
  }

  /**
   * Bounded, sanitised result for the case where the lease was lost *and* the
   * subsequent progress read failed, so ownership cannot be established. This is
   * a failure (not a hand-off): the worker wrote nothing, the row is untouched,
   * and a later run can reclaim it. It is intentionally distinguishable from a
   * normal ownership-loss `skipped` result and carries no raw database detail.
   */
  function ownershipUnverifiedResult(documentId, { completedChunkCount, totalChunks }) {
    return {
      documentId,
      spaceId,
      status: 'failed',
      category: 'ownership_unverified',
      retryable: true,
      embeddedChunks: completedChunkCount,
      totalChunks,
      error: 'Backfill ownership could not be verified after the lease was lost; the attempt was abandoned without writing.'
    };
  }

  /**
   * Best-effort, non-throwing read of a document's progress row, used only to
   * diagnose *why* a fenced write was refused.
   *
   * Returns:
   *   * the progress record when the row exists,
   *   * `null` when the row is genuinely missing (the chunk set or document was
   *     replaced underneath the attempt),
   *   * `PROGRESS_READ_UNAVAILABLE` when the read itself failed. Callers must
   *     treat this as "ownership unknown" and fail closed — a database read
   *     error is never proof that another worker took the document over.
   */
  async function readProgressSafely(documentId) {
    try {
      return await embeddingBackfillProgressRepository.getProgress(spaceId, documentId);
    } catch (readError) {
      const message = readError instanceof Error ? readError.message : 'unknown error';
      logger.error(`Failed to read backfill progress for ${documentId}: ${message}`);
      return PROGRESS_READ_UNAVAILABLE;
    }
  }

  return {
    spaceId,

    async planDocument(documentId) {
      const inspection = await inspect(documentId);

      if (!inspection) {
        return null;
      }

      return {
        documentId,
        spaceId,
        totalChunks: inspection.totalChunks,
        embeddedChunks: inspection.embeddedChunks,
        missingChunks: inspection.missingChunkIds.length,
        complete: inspection.missingChunkIds.length === 0
      };
    },

    backfillDocument,

    async run(documentIds) {
      if (!Array.isArray(documentIds)) {
        throw new ValidationError('"run" expects an array of document ids.');
      }

      const results = [];

      for (const documentId of documentIds) {
        results.push(await backfillDocument(documentId));
      }

      return results;
    }
  };
}
