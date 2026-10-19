#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { DocumentsRepository } from '../../server/documents/repository.js';
import { EmbeddingReconciliation } from '../../server/documents/embeddingReconciliation.js';
import { ChunkEmbeddingRepository } from '../../server/embeddings/chunkEmbeddingRepository.js';
import { createEmbeddingBackfillRunner } from '../../server/embeddings/embeddingBackfillRunner.js';
import { EmbeddingBackfillProgressRepository } from '../../server/embeddings/embeddingBackfillProgressRepository.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { evaluateEmbeddingEligibility } from '../../server/embeddings/embeddingEligibility.js';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ValidationError } from '../../server/errors.js';
import {
  ALLOW_DATABASE_ENV,
  TARGET_SPACE_ID,
  createReadOnlyRunner,
  preflightSchema,
  resolveTarget,
  verifyTarget
} from './embedding-backfill.mjs';

/**
 * Atlas embedding-backfill WRITE-MODE entry point (operator/migration).
 *
 * This is the bounded, auditable execution mechanism for backfilling the Voyage
 * target space (`chunk_embeddings`). It is deliberately conservative:
 *
 *   * Defaults to a read-only dry-run preview. Writes require `--write`.
 *   * Write mode additionally requires that the exact target database name is
 *     explicitly allowlisted (`--allow-database <name>` or `${ALLOW_DATABASE_ENV}`).
 *     Authorization is never inferred from a hostname or a disposable name.
 *   * It reuses the read-only tool's target resolver, so a remote host, a target
 *     equal to `DATABASE_URL`, a production-patterned name, and a non-local
 *     server address are all still refused.
 *   * It constructs the runner with the explicit `operator` eligibility policy;
 *     the runner independently rejects any document that is not `ready` at three
 *     points, so a non-ready document can never reach the provider.
 *   * It revalidates the connected database identity immediately before each
 *     document attempt.
 *   * Writes are bounded to a single document by default, with a strict maximum.
 *   * It never retries a failed document within a run, and stops on the first
 *     unexpected status, eligibility rejection, identity mismatch, provider error,
 *     accounting anomaly, or unrelated-document change.
 *   * Provider calls never happen inside a database transaction (the runner owns
 *     that invariant); SIGINT/SIGTERM stops scheduling new work and reports
 *     partial progress honestly.
 *   * It only ever writes the Voyage target space through the runner: it cannot
 *     change the active retrieval space or delete existing BGE embeddings.
 *
 * Usage:
 *   node scripts/dev/embedding-backfill-write.mjs \
 *     --database-url postgresql:///atlas_backfill_test?host=/tmp
 *
 *   node scripts/dev/embedding-backfill-write.mjs --write \
 *     --database-url postgresql:///atlas_backfill_test?host=/tmp \
 *     --allow-database atlas_backfill_test --limit 1 --json
 *
 * Exit codes:
 *   0  every attempted document completed and verified (preview always exits 0)
 *   1  refused / fatal before any document was attempted (config, identity, schema)
 *   2  stopped early after attempting at least one document (partial run)
 */

export const WRITE_DB_ENV = 'ATLAS_BACKFILL_WRITE_DATABASE_URL';
export const WRITE_ELIGIBILITY_POLICY = 'operator';
export const DEFAULT_DOCUMENTS_PER_RUN = 1;
export const MAX_DOCUMENTS_PER_RUN = 25;

const WRITE_FLAG = '--write';
const DRY_RUN_FLAG = '--dry-run';

export const USAGE = `Atlas embedding-backfill (write mode, operator)

Usage:
  node scripts/dev/embedding-backfill-write.mjs [options]

  With no --write this is a read-only preview (default).

Required for --write:
  --write                    Perform writes. Without it, only a preview is shown.
  --allow-database <name>    Explicitly authorize the exact target database name
                             (repeatable). Also ${ALLOW_DATABASE_ENV} (comma-separated).

Options:
  --database-url <url>       Explicit target database. Falls back to ${WRITE_DB_ENV}.
  --limit <n>                Documents to process (default ${DEFAULT_DOCUMENTS_PER_RUN}, max ${MAX_DOCUMENTS_PER_RUN}).
  --json                     Emit machine-readable JSON instead of text.
  --help                     Show this message.

Safety:
  * Default dry-run preview performs no writes and calls no provider.
  * --write requires an explicit allowlist entry for the exact database name.
  * Only a local database is accepted; a non-local host, a target equal to
    DATABASE_URL, a production-patterned name, and a non-local server address are
    refused. Production-patterned names stay refused even when allowlisted.
  * The runner is always constructed with the explicit "operator" eligibility
    policy: only "ready" documents may be embedded.
  * No automatic retry of a failed document; execution stops at the first
    unexpected condition and reports partial progress honestly.
  * Only the Voyage target space is written. The active retrieval space and BGE
    embeddings are never modified.
`;

function sanitizeMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = message.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();

  if (cleaned.length === 0) {
    return 'Operation failed.';
  }

  return cleaned.length > 300 ? `${cleaned.slice(0, 299).trimEnd()}…` : cleaned;
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ValidationError('"limit" must be a positive integer.');
  }

  if (limit > MAX_DOCUMENTS_PER_RUN) {
    throw new ValidationError(`"limit" must be at most ${MAX_DOCUMENTS_PER_RUN}.`);
  }

  return limit;
}

/**
 * Parse write-mode CLI arguments. Throws on unknown arguments, an out-of-range
 * `--limit`, or `--write` combined with `--dry-run`. When neither flag is given
 * the default is a read-only preview.
 */
export function parseWriteArgs(argv) {
  const args = {
    help: false,
    write: false,
    dryRun: false,
    json: false,
    limit: DEFAULT_DOCUMENTS_PER_RUN,
    databaseUrl: null,
    allowDatabases: []
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      const value = argv[(i += 1)];

      if (value === undefined) {
        throw new ValidationError(`Missing value for ${token}.`);
      }

      return value;
    };

    switch (token) {
      case '--help':
        args.help = true;
        break;

      case WRITE_FLAG:
        args.write = true;
        break;

      case DRY_RUN_FLAG:
        args.dryRun = true;
        break;

      case '--json':
        args.json = true;
        break;

      case '--database-url':
        args.databaseUrl = next();
        break;

      case '--allow-database': {
        const value = next();

        if (value.trim().length === 0) {
          throw new ValidationError('Missing value for --allow-database.');
        }

        args.allowDatabases.push(value.trim());
        break;
      }

      case '--limit': {
        const value = Number(next());
        args.limit = validateLimit(value);
        break;
      }

      default:
        throw new ValidationError(`Unknown argument: ${token}`);
    }
  }

  if (args.write && args.dryRun) {
    throw new ValidationError('--write and --dry-run are mutually exclusive.');
  }

  if (!args.write) {
    args.dryRun = true;
  }

  return args;
}

/**
 * Resolve the target and, for write mode, require that the exact target database
 * name was explicitly allowlisted. Authorization is never inferred from a
 * hostname or a disposable-looking name.
 */
export function resolveWriteTarget({ args = {}, env = {} } = {}) {
  const databaseUrl = args.databaseUrl ?? env[WRITE_DB_ENV] ?? null;

  if (!databaseUrl) {
    throw new ValidationError(
      `A target database is required (--database-url or ${WRITE_DB_ENV}).`
    );
  }

  const target = resolveTarget({
    args: { allowDatabases: args.allowDatabases, databaseUrl },
    env
  });

  if (args.write === true) {
    const allowlist = target.allowlist instanceof Set ? target.allowlist : new Set();

    if (!allowlist.has(target.database)) {
      throw new ValidationError(
        `Refusing write mode: database "${target.database}" is not explicitly allowlisted. `
        + `Add --allow-database ${target.database} or set ${ALLOW_DATABASE_ENV}.`
      );
    }
  }

  return target;
}

/**
 * Wrap an embedding provider so every dispatch is counted and every reported
 * usage total is accumulated. A dispatch that does not report usage marks the
 * run's usage as unavailable rather than being coerced to zero.
 *
 * @returns {{ provider: object, snapshot: () => { dispatches: number, totalTokens: number, allUsageAvailable: boolean } }}
 */
export function createMeteredProvider(inner) {
  if (!inner || (typeof inner.embedMany !== 'function' && typeof inner.embedManyWithUsage !== 'function')) {
    throw new ValidationError('A metered provider requires an embedding provider with embedMany or embedManyWithUsage.');
  }

  const state = { dispatches: 0, totalTokens: 0, allUsageAvailable: true };

  const record = (usage, usageAvailable) => {
    state.dispatches += 1;

    if (usageAvailable === true && usage && Number.isFinite(usage.totalTokens)) {
      state.totalTokens += Number(usage.totalTokens);
      return;
    }

    state.allUsageAvailable = false;
  };

  const provider = {};

  if (typeof inner.embedManyWithUsage === 'function') {
    provider.embedManyWithUsage = async (texts) => {
      const result = await inner.embedManyWithUsage(texts);
      record(result?.usage, result?.usageAvailable);
      return result;
    };
  }

  if (typeof inner.embedMany === 'function') {
    provider.embedMany = async (texts) => {
      const embeddings = await inner.embedMany(texts);
      record(null, false);
      return embeddings;
    };
  }

  return {
    provider,
    snapshot() {
      return {
        dispatches: state.dispatches,
        totalTokens: state.totalTokens,
        allUsageAvailable: state.allUsageAvailable
      };
    }
  };
}

function attributeUsage(before, after) {
  const dispatches = after.dispatches - before.dispatches;

  if (dispatches === 0) {
    return { dispatches: 0, tokens: 0, usageAvailable: true };
  }

  const usageAvailable = after.allUsageAvailable === true;
  const tokens = usageAvailable ? Math.max(after.totalTokens - before.totalTokens, 0) : null;

  return { dispatches, tokens, usageAvailable };
}

/**
 * Build the write-mode runner with the explicit `operator` eligibility policy.
 *
 * `repositories` is overridable so tests can supply fakes; production passes no
 * override and gets the real repositories bound to `pool`.
 */
export function createWriteRunner({
  pool,
  embeddingProvider,
  logger = console,
  repositories = null,
  runInTransaction = null,
  batchSize = 8,
  leaseMs = undefined
} = {}) {
  const repos = repositories ?? {
    documentsRepository: new DocumentsRepository(pool),
    embeddingRepository: new EmbeddingRepository(pool),
    chunkEmbeddingRepository: new ChunkEmbeddingRepository(pool),
    embeddingBackfillProgressRepository: new EmbeddingBackfillProgressRepository(pool)
  };

  return createEmbeddingBackfillRunner({
    pool,
    documentsRepository: repos.documentsRepository,
    embeddingRepository: repos.embeddingRepository,
    chunkEmbeddingRepository: repos.chunkEmbeddingRepository,
    embeddingBackfillProgressRepository: repos.embeddingBackfillProgressRepository,
    embeddingProvider,
    space: VOYAGE_SPACE,
    batchSize,
    ...(leaseMs === undefined ? {} : { leaseMs }),
    eligibilityPolicy: WRITE_ELIGIBILITY_POLICY,
    runInTransaction,
    logger
  });
}

/**
 * Build a live auditor over a pool. Every method is a read; nothing is written.
 * Completeness is identity-based (`chunk_embeddings` keyed by chunk id), never a
 * progress-row status.
 */
export function createDbAuditor(pool, {
  spaceId = TARGET_SPACE_ID,
  progressRepository = new EmbeddingBackfillProgressRepository(pool),
  chunkEmbeddingRepository = new ChunkEmbeddingRepository(pool),
  documentsRepository = new DocumentsRepository(pool)
} = {}) {
  return {
    async readDocument(documentId) {
      return documentsRepository.getDocumentById(documentId);
    },

    async readProgress(documentId) {
      return progressRepository.getProgress(spaceId, documentId);
    },

    async verifyCompleteness(documentId) {
      return chunkEmbeddingRepository.isDocumentFullyEmbedded(documentId, spaceId);
    },

    async snapshot() {
      const embeddings = await pool.query(
        `SELECT document_id, count(*)::int AS n
           FROM chunk_embeddings
          WHERE space_id = $1
          GROUP BY document_id`,
        [spaceId]
      );

      const statuses = await pool.query('SELECT id, status FROM documents');

      const orphaned = await pool.query(
        `SELECT count(*)::int AS n
           FROM chunk_embeddings ce
           LEFT JOIN chunks c ON c.id = ce.chunk_id
          WHERE ce.space_id = $1
            AND c.id IS NULL`,
        [spaceId]
      );

      const duplicate = await pool.query(
        `SELECT count(*)::int AS n
           FROM (
             SELECT chunk_id
               FROM chunk_embeddings
              WHERE space_id = $1
              GROUP BY chunk_id
             HAVING count(*) > 1
           ) AS duplicates`,
        [spaceId]
      );

      const counts = new Map();

      for (const row of embeddings.rows ?? []) {
        counts.set(row.document_id, Number(row.n));
      }

      const statusMap = new Map();

      for (const row of statuses.rows ?? []) {
        statusMap.set(row.id, row.status);
      }

      return {
        embeddings: counts,
        statuses: statusMap,
        orphanedCount: Number(orphaned.rows[0]?.n ?? 0),
        duplicateCount: Number(duplicate.rows[0]?.n ?? 0)
      };
    }
  };
}

async function safePlan(runner, documentId) {
  try {
    return await runner.planDocument(documentId);
  } catch {
    return null;
  }
}

async function safeReadDocument(readDocument, documentId, fallbackStatus) {
  if (typeof readDocument !== 'function') {
    return { status: fallbackStatus };
  }

  try {
    return await readDocument(documentId);
  } catch {
    return { status: fallbackStatus };
  }
}

async function safeCompleteness(auditor, documentId) {
  try {
    return await auditor.verifyCompleteness(documentId);
  } catch {
    return null;
  }
}

async function safeProgress(auditor, documentId) {
  if (!auditor || typeof auditor.readProgress !== 'function') {
    return null;
  }

  try {
    return await auditor.readProgress(documentId);
  } catch {
    return null;
  }
}

function diffSnapshots(before, after, processedIds) {
  const embeddings = [];
  const statuses = [];

  const embeddingIds = new Set([...before.embeddings.keys(), ...after.embeddings.keys()]);

  for (const id of embeddingIds) {
    if (processedIds.has(id)) {
      continue;
    }

    const beforeCount = before.embeddings.get(id) ?? 0;
    const afterCount = after.embeddings.get(id) ?? 0;

    if (afterCount !== beforeCount) {
      embeddings.push({ documentId: id, before: beforeCount, after: afterCount });
    }
  }

  const statusIds = new Set([...before.statuses.keys(), ...after.statuses.keys()]);

  for (const id of statusIds) {
    if (processedIds.has(id)) {
      continue;
    }

    const beforeStatus = before.statuses.get(id) ?? null;
    const afterStatus = after.statuses.get(id) ?? null;

    if (afterStatus !== beforeStatus) {
      statuses.push({ documentId: id, before: beforeStatus, after: afterStatus });
    }
  }

  return { embeddings, statuses };
}

/**
 * Run a bounded write backfill. Exactly one document is attempted at a time and
 * execution stops on the first document that does not complete — there is no
 * automatic retry. Reads are injected so the mechanism is testable without a
 * database or a provider.
 */
export async function runWriteBackfill({
  enumerate,
  runner,
  auditor,
  meter,
  readDocument = null,
  revalidateIdentity = null,
  limit = DEFAULT_DOCUMENTS_PER_RUN,
  spaceId = TARGET_SPACE_ID,
  shouldStop = () => false,
  now = () => new Date(),
  logger = console
} = {}) {
  if (typeof enumerate !== 'function') {
    throw new ValidationError('A document enumerator is required.');
  }

  if (!runner || typeof runner.backfillDocument !== 'function') {
    throw new ValidationError('A backfill runner exposing backfillDocument() is required.');
  }

  if (!auditor || typeof auditor.snapshot !== 'function' || typeof auditor.verifyCompleteness !== 'function') {
    throw new ValidationError('An auditor exposing snapshot() and verifyCompleteness() is required.');
  }

  if (!meter || typeof meter.snapshot !== 'function') {
    throw new ValidationError('A provider meter is required.');
  }

  validateLimit(limit);

  const generatedAt = now().toISOString();
  const before = await auditor.snapshot();
  const documents = [];
  const anomalies = [];
  const warnings = [];
  let afterId = null;
  let attempted = 0;
  let completed = 0;
  let failed = 0;
  let ineligible = 0;
  let skipped = 0;
  let missing = 0;
  let unexpected = 0;
  let zeroChunkCount = 0;
  let truncated = false;
  let stoppedEarly = false;
  let stopReason = null;

  while (attempted < limit) {
    if (shouldStop()) {
      stoppedEarly = true;
      stopReason = 'interrupted';
      break;
    }

    const page = await enumerate({ limit: 1, afterId });

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    const key = page[0];
    afterId = key.documentId;

    const documentId = key.documentId;
    const enumeratedStatus = typeof key.status === 'string' ? key.status : null;

    // The enumerator is only supposed to return `ready` documents. Anything else
    // is an unexpected status: stop before touching it.
    if (enumeratedStatus !== 'ready') {
      anomalies.push({
        documentId,
        type: 'enumeration_status',
        detail: `enumerated status "${enumeratedStatus ?? 'unknown'}" is not "ready"`
      });
      stoppedEarly = true;
      stopReason = 'unexpected_status';
      break;
    }

    // Revalidate the connected database identity immediately before any write.
    if (typeof revalidateIdentity === 'function') {
      try {
        await revalidateIdentity();
      } catch (error) {
        anomalies.push({ documentId, type: 'identity_mismatch', detail: sanitizeMessage(error) });
        stoppedEarly = true;
        stopReason = 'identity_mismatch';
        break;
      }
    }

    const initialDocument = await safeReadDocument(readDocument, documentId, enumeratedStatus);
    const initialEligibility = evaluateEmbeddingEligibility(initialDocument, WRITE_ELIGIBILITY_POLICY);
    const planBefore = typeof runner.planDocument === 'function' ? await safePlan(runner, documentId) : null;
    const meterBefore = meter.snapshot();

    attempted += 1;

    let result;

    try {
      result = await runner.backfillDocument(documentId);
    } catch (error) {
      const detail = sanitizeMessage(error);
      const usage = attributeUsage(meterBefore, meter.snapshot());

      anomalies.push({ documentId, type: 'runner_error', detail });
      documents.push({
        documentId,
        enumeratedStatus,
        initialStatus: initialDocument?.status ?? null,
        initialEligible: initialEligibility.eligible,
        initialEligibilityReason: initialEligibility.reason,
        initialTotalChunks: planBefore?.totalChunks ?? null,
        initialEmbeddedChunks: planBefore?.embeddedChunks ?? null,
        initialMissingChunks: planBefore?.missingChunks ?? null,
        finalStatus: 'error',
        reason: detail,
        category: 'runner_error',
        retryable: null,
        providerDispatches: usage.dispatches,
        tokens: usage.tokens,
        usageAvailable: usage.usageAvailable,
        progressStatus: null,
        progressCompleted: false,
        completeness: null,
        verified: false,
        zeroChunk: false,
        outcome: 'error'
      });
      failed += 1;
      stoppedEarly = true;
      stopReason = 'runner_error';
      break;
    }

    const usage = attributeUsage(meterBefore, meter.snapshot());
    const completeness = typeof auditor.verifyCompleteness === 'function'
      ? await safeCompleteness(auditor, documentId)
      : null;
    const progress = await safeProgress(auditor, documentId);

    const finalStatus = typeof result?.status === 'string' ? result.status : 'unknown';
    const totalChunks = completeness?.totalChunks ?? planBefore?.totalChunks ?? null;
    const zeroChunk = totalChunks === 0;
    const verified = finalStatus === 'completed' && completeness?.complete === true;
    const progressCompleted = progress?.status === 'completed';

    if (finalStatus === 'completed' && completeness && completeness.complete !== true) {
      anomalies.push({
        documentId,
        type: 'completion_without_completeness',
        detail: 'runner reported completed but identity-based completeness is false'
      });
    }

    if (
      progress
      && progress.tokensAvailable === true
      && usage.usageAvailable === true
      && usage.dispatches > 0
      && Number(progress.tokenCount) !== usage.tokens
    ) {
      anomalies.push({
        documentId,
        type: 'token_accounting',
        detail: `progress token_count ${progress.tokenCount} != metered ${usage.tokens}`
      });
    }

    let outcome;

    if (finalStatus === 'completed') {
      outcome = 'completed';
      completed += 1;

      if (zeroChunk) {
        zeroChunkCount += 1;
        warnings.push({
          documentId,
          type: 'zero_chunk',
          detail: 'document has zero chunks; reported complete without any embedding work (not migration work)'
        });
      }
    } else if (finalStatus === 'failed') {
      outcome = 'failed';
      failed += 1;
    } else if (finalStatus === 'ineligible') {
      outcome = 'ineligible';
      ineligible += 1;
    } else if (finalStatus === 'skipped') {
      outcome = 'skipped';
      skipped += 1;
    } else if (finalStatus === 'missing') {
      outcome = 'missing';
      missing += 1;
    } else {
      outcome = 'unexpected';
      unexpected += 1;
    }

    documents.push({
      documentId,
      enumeratedStatus,
      initialStatus: initialDocument?.status ?? null,
      initialEligible: initialEligibility.eligible,
      initialEligibilityReason: initialEligibility.reason,
      initialTotalChunks: planBefore?.totalChunks ?? null,
      initialEmbeddedChunks: planBefore?.embeddedChunks ?? null,
      initialMissingChunks: planBefore?.missingChunks ?? null,
      finalStatus,
      reason: result?.reason ?? result?.error ?? null,
      category: result?.category ?? null,
      retryable: result?.retryable ?? null,
      providerDispatches: usage.dispatches,
      tokens: usage.tokens,
      usageAvailable: usage.usageAvailable,
      progressStatus: progress?.status ?? null,
      progressCompleted,
      completeness: completeness
        ? {
            totalChunks: completeness.totalChunks,
            embeddedChunks: completeness.embeddedChunks,
            missingChunks: completeness.missingChunks,
            complete: completeness.complete
          }
        : null,
      verified,
      zeroChunk,
      outcome
    });

    if (finalStatus !== 'completed') {
      stoppedEarly = true;
      stopReason = finalStatus === 'failed' ? (result?.category ?? 'failed') : finalStatus;
      break;
    }
  }

  if (attempted >= limit) {
    const peek = await enumerate({ limit: 1, afterId });
    truncated = Array.isArray(peek) && peek.length > 0;
  }

  const after = await auditor.snapshot();
  const processedIds = new Set(documents.map((document) => document.documentId));
  const unrelated = diffSnapshots(before, after, processedIds);

  if (after.orphanedCount > before.orphanedCount) {
    anomalies.push({
      type: 'orphaned_embeddings',
      detail: `orphaned target-space embeddings grew from ${before.orphanedCount} to ${after.orphanedCount}`
    });
  }

  if (after.duplicateCount > 0) {
    anomalies.push({ type: 'duplicate_embeddings', detail: `${after.duplicateCount} duplicate target-space embedding row(s) detected` });
  }

  const finalMeter = meter.snapshot();
  const unrelatedChanged = unrelated.embeddings.length > 0 || unrelated.statuses.length > 0;
  const allSuccessful = !stoppedEarly
    && anomalies.length === 0
    && !unrelatedChanged
    && completed === attempted;

  return {
    tool: 'atlas-embedding-backfill-write',
    mode: 'write',
    readOnly: false,
    operatorPolicy: WRITE_ELIGIBILITY_POLICY,
    spaceId,
    generatedAt,
    limit,
    attemptedDocuments: attempted,
    completedDocuments: completed,
    failedDocuments: failed,
    ineligibleDocuments: ineligible,
    skippedDocuments: skipped,
    missingDocuments: missing,
    unexpectedDocuments: unexpected,
    zeroChunkDocuments: zeroChunkCount,
    providerDispatches: finalMeter.dispatches,
    tokens: finalMeter.allUsageAvailable ? finalMeter.totalTokens : null,
    usageAvailable: finalMeter.dispatches === 0 ? true : finalMeter.allUsageAvailable,
    unrelatedDocumentChanges: unrelated,
    anomalies,
    warnings,
    stoppedEarly,
    stopReason,
    truncated,
    allSuccessful,
    documents
  };
}

/**
 * Read-only preview. Enumerates ready documents in a bounded batch and reports
 * their planned chunk counts. Performs no writes and never calls a provider (the
 * preview runner is the read-only runner with a throwing provider).
 */
export async function runWritePreview({
  enumerate,
  runner,
  limit = DEFAULT_DOCUMENTS_PER_RUN,
  spaceId = TARGET_SPACE_ID,
  shouldStop = () => false,
  now = () => new Date()
} = {}) {
  if (typeof enumerate !== 'function') {
    throw new ValidationError('A document enumerator is required.');
  }

  if (!runner || typeof runner.planDocument !== 'function') {
    throw new ValidationError('A backfill runner exposing planDocument() is required.');
  }

  validateLimit(limit);

  const documents = [];
  let afterId = null;
  let truncated = false;

  while (documents.length < limit) {
    if (shouldStop()) {
      break;
    }

    const page = await enumerate({ limit: 1, afterId });

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    const key = page[0];
    afterId = key.documentId;

    let plan = null;

    try {
      plan = await runner.planDocument(key.documentId);
    } catch {
      plan = null;
    }

    documents.push({
      documentId: key.documentId,
      status: key.status ?? null,
      totalChunks: plan?.totalChunks ?? null,
      embeddedChunks: plan?.embeddedChunks ?? null,
      missingChunks: plan?.missingChunks ?? null,
      complete: plan?.complete ?? null
    });
  }

  if (documents.length === limit) {
    const peek = await enumerate({ limit: 1, afterId });
    truncated = Array.isArray(peek) && peek.length > 0;
  }

  return {
    tool: 'atlas-embedding-backfill-write',
    mode: 'dry-run',
    readOnly: true,
    operatorPolicy: WRITE_ELIGIBILITY_POLICY,
    spaceId,
    generatedAt: now().toISOString(),
    limit,
    eligibleDocuments: documents.length,
    documentsNeedingWork: documents.filter((document) => document.missingChunks > 0).length,
    truncated,
    documents,
    note: 'Read-only preview. No writes, no provider calls. This is not a backfill.'
  };
}

export function formatWriteJsonReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function documentLine(document) {
  if (document.outcome === 'completed' || document.finalStatus === 'completed') {
    const zero = document.zeroChunk ? '  ZERO-CHUNK (no work)' : '';
    const usage = document.usageAvailable ? `${document.tokens} tokens` : 'usage unavailable';
    return `  ${document.documentId}  status=ready  dispatches=${document.providerDispatches}  `
      + `${usage}  verified=${document.verified}  progress=${document.progressCompleted ? 'completed' : 'none'}${zero}`;
  }

  return `  ${document.documentId}  status=${document.initialStatus ?? 'unknown'}  `
    + `final=${document.finalStatus}  reason=${document.reason ?? document.category ?? '(none)'}  `
    + `dispatches=${document.providerDispatches}  verified=${document.verified}`;
}

export function formatWriteTextReport(report) {
  const lines = [];

  if (report.mode === 'dry-run') {
    lines.push('Atlas embedding backfill — DRY RUN (preview, read-only)');
    lines.push(`Target:    ${report.target ?? '(unspecified)'}`);
    lines.push(`Space:     ${report.spaceId}`);
    lines.push(`Policy:    ${report.operatorPolicy}`);
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push('');
    lines.push('Read-only preview. No writes, no provider calls.');
    lines.push('');
    lines.push(`Documents (${report.documents.length}):`);

    if (report.documents.length === 0) {
      lines.push('  (none)');
    } else {
      for (const document of report.documents) {
        const verdict = document.complete === true ? 'complete' : 'NEEDS WORK';
        lines.push(
          `  ${document.documentId}  status=${document.status ?? 'unknown'}  `
          + `chunks=${document.totalChunks}  embedded=${document.embeddedChunks}  `
          + `missing=${document.missingChunks}  ${verdict}`
        );
      }
    }

    if (report.truncated) {
      lines.push('');
      lines.push(`WARNING: partial preview — --limit ${report.limit} reached; more ready documents exist.`);
    }

    lines.push('');
    lines.push('Result: PREVIEW ONLY (no writes performed)');
    return `${lines.join('\n')}\n`;
  }

  lines.push('Atlas embedding backfill — WRITE MODE (operator)');
  lines.push(`Target:    ${report.target ?? '(unspecified)'}`);
  lines.push(`Space:     ${report.spaceId}`);
  lines.push(`Policy:    ${report.operatorPolicy}`);
  lines.push(`Limit:     ${report.limit}`);
  lines.push(`Generated: ${report.generatedAt}`);

  if (report.allowlistedTarget) {
    lines.push('');
    lines.push(`WARNING: target "${report.target}" was explicitly allowlisted and is NOT a`);
    lines.push('disposable-named database. Confirm it is the intended local copy.');
  }

  lines.push('');
  lines.push(`Documents attempted (${report.attemptedDocuments}):`);

  if (report.documents.length === 0) {
    lines.push('  (none)');
  } else {
    for (const document of report.documents) {
      lines.push(documentLine(document));
    }
  }

  lines.push('');
  lines.push('Aggregates:');
  lines.push(`  Attempted:              ${report.attemptedDocuments}`);
  lines.push(`  Completed:              ${report.completedDocuments}`);
  lines.push(`  Failed:                 ${report.failedDocuments}`);
  lines.push(`  Ineligible:             ${report.ineligibleDocuments}`);
  lines.push(`  Skipped:                ${report.skippedDocuments}`);
  lines.push(`  Missing:                ${report.missingDocuments}`);
  lines.push(`  Unexpected:             ${report.unexpectedDocuments}`);
  lines.push(`  Zero-chunk:             ${report.zeroChunkDocuments}`);
  lines.push(`  Provider dispatches:    ${report.providerDispatches}`);
  lines.push(`  Tokens:                 ${report.tokens === null ? 'unavailable' : report.tokens}`);
  lines.push(`  Usage complete:         ${report.usageAvailable === true ? 'yes' : 'no'}`);

  const unrelatedEmbeddings = report.unrelatedDocumentChanges.embeddings;
  const unrelatedStatuses = report.unrelatedDocumentChanges.statuses;

  if (unrelatedEmbeddings.length > 0 || unrelatedStatuses.length > 0) {
    lines.push('');
    lines.push('WARNING: unrelated documents changed:');

    for (const change of unrelatedEmbeddings) {
      lines.push(`  ${change.documentId}: embeddings ${change.before} -> ${change.after}`);
    }

    for (const change of unrelatedStatuses) {
      lines.push(`  ${change.documentId}: status ${change.before ?? 'none'} -> ${change.after ?? 'none'}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(`WARNING: ${report.warnings.length} zero-chunk document(s) reported complete without work`);
    lines.push('(these are not migration work and require manual review).');
  }

  if (report.anomalies.length > 0) {
    lines.push('');
    lines.push(`ANOMALIES (${report.anomalies.length}):`);

    for (const anomaly of report.anomalies) {
      lines.push(`  ${anomaly.documentId ?? '(run)'}: ${anomaly.type} — ${anomaly.detail}`);
    }
  }

  if (report.truncated) {
    lines.push('');
    lines.push(`NOTE: more ready documents remain beyond --limit ${report.limit}.`);
  }

  if (report.stoppedEarly) {
    lines.push('');
    lines.push(`WARNING: run stopped early (${report.stopReason}). No document was retried.`);
  }

  lines.push('');
  lines.push(`Result: ${report.allSuccessful ? 'SUCCESS' : (report.attemptedDocuments === 0 ? 'REFUSED' : 'PARTIAL')}`);

  return `${lines.join('\n')}\n`;
}

function computeWriteExitCode(report) {
  if (report.allSuccessful) {
    return 0;
  }

  return report.attemptedDocuments === 0 ? 1 : 2;
}

async function closePool(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
}

function installSignalHandlers(state) {
  const handler = () => {
    if (state && typeof state === 'object') {
      state.stopRequested = true;
    }
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);

  return () => {
    process.removeListener('SIGINT', handler);
    process.removeListener('SIGTERM', handler);
  };
}

/**
 * CLI entry point. Returns `{ exitCode, report, output }` and never throws for
 * expected conditions. The pool is always closed, on success and failure.
 */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  deps = {}
} = {}) {
  const write = deps.write ?? ((text) => process.stdout.write(text));
  const writeError = deps.writeError ?? ((text) => process.stderr.write(text));
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());
  const createPool = deps.createPool ?? ((target) => new Pool({ connectionString: target.connectionString, ssl: false }));
  const createEnumerator = deps.createEnumerator ?? ((pool) => new EmbeddingReconciliation(pool));
  const createProvider = deps.createProvider ?? ((providerEnv) => createEmbeddingProvider({ providerName: 'voyage', env: providerEnv }));
  const createRunner = deps.createRunner ?? ((options) => createWriteRunner(options));
  const createPreviewRunner = deps.createPreviewRunner ?? ((pool) => createReadOnlyRunner(pool, { logger }));
  const createAuditor = deps.createAuditor ?? ((pool) => createDbAuditor(pool));
  const readDocumentFactory = deps.readDocument ?? ((pool) => {
    const repository = new DocumentsRepository(pool);
    return (documentId) => repository.getDocumentById(documentId);
  });
  const verifyTargetFn = deps.verifyTarget ?? verifyTarget;
  const preflightSchemaFn = deps.preflightSchema ?? preflightSchema;
  const signalState = deps.signalState ?? { stopRequested: false };
  const installSignals = deps.installSignalHandlers ?? installSignalHandlers;

  let args;

  try {
    args = parseWriteArgs(argv);
  } catch (error) {
    writeError(`embedding-backfill-write: ${sanitizeMessage(error)}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  if (args.help) {
    write(USAGE);
    return { exitCode: 0, report: null, output: USAGE };
  }

  let target;

  try {
    target = resolveWriteTarget({ args, env });
  } catch (error) {
    writeError(`embedding-backfill-write: ${sanitizeMessage(error)}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  let pool;

  try {
    pool = createPool(target);
  } catch (error) {
    writeError(`embedding-backfill-write: ${sanitizeMessage(error)}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  const uninstallSignals = typeof installSignals === 'function'
    ? installSignals(signalState)
    : () => {};
  const shouldStop = () => signalState.stopRequested === true;

  let report;

  try {
    try {
      await verifyTargetFn(pool, target);
      await preflightSchemaFn(pool);

      const reconciliation = createEnumerator(pool);

      if (!reconciliation || typeof reconciliation.listReadyDocuments !== 'function') {
        throw new ValidationError('The document enumerator does not support listReadyDocuments().');
      }

      const enumerate = ({ limit, afterId }) => reconciliation.listReadyDocuments({ limit, afterId });

      if (args.write) {
        const metered = createMeteredProvider(createProvider(env));
        const runner = createRunner({ pool, embeddingProvider: metered.provider, logger });

        report = await runWriteBackfill({
          enumerate,
          runner,
          meter: metered,
          auditor: createAuditor(pool),
          readDocument: readDocumentFactory(pool),
          revalidateIdentity: () => verifyTargetFn(pool, target),
          limit: args.limit,
          spaceId: TARGET_SPACE_ID,
          shouldStop,
          now,
          logger
        });
      } else {
        const runner = createPreviewRunner(pool);

        report = await runWritePreview({
          enumerate,
          runner,
          limit: args.limit,
          spaceId: TARGET_SPACE_ID,
          shouldStop,
          now
        });
      }

      report.target = target.safeLabel;
      report.allowlistedTarget = target.allowlisted === true;
    } finally {
      if (typeof uninstallSignals === 'function') {
        uninstallSignals();
      }

      await closePool(pool);
    }
  } catch (error) {
    writeError(`embedding-backfill-write: ${sanitizeMessage(error)}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  const output = args.json ? formatWriteJsonReport(report) : formatWriteTextReport(report);
  write(output);

  const exitCode = report.mode === 'write' ? computeWriteExitCode(report) : 0;

  return { exitCode, report, output };
}

function isDirectExecution() {
  const entry = process.argv[1];

  if (!entry) {
    return false;
  }

  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`embedding-backfill-write: ${sanitizeMessage(error)}\n`);
      process.exitCode = 1;
    });
}
