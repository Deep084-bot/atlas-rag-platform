#!/usr/bin/env node
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { EmbeddingReconciliation } from '../../server/documents/embeddingReconciliation.js';
import { DocumentsRepository } from '../../server/documents/repository.js';
import { ChunkEmbeddingRepository } from '../../server/embeddings/chunkEmbeddingRepository.js';
import { createEmbeddingBackfillRunner } from '../../server/embeddings/embeddingBackfillRunner.js';
import { EmbeddingBackfillProgressRepository } from '../../server/embeddings/embeddingBackfillProgressRepository.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';
import { ValidationError } from '../../server/errors.js';

/**
 * Atlas embedding-backfill dry-run inspector (read-only).
 *
 * Reports which `ready` documents still need embeddings in the Voyage target
 * space by using the backfill runner's read-only `planDocument()`. It is a
 * point-in-time inspection: it performs no writes, records no progress rows,
 * changes no document status, and never calls an embedding provider.
 *
 * Safety:
 *   * Dry-run only. `--dry-run` is required; `--execute`/`--apply`/`--write`
 *     are explicitly refused.
 *   * Requires an explicit `--database-url` or `ATLAS_BACKFILL_DATABASE_URL`.
 *     It never falls back to `DATABASE_URL`.
 *   * Refuses any target equal to `DATABASE_URL`, any non-local host, and any
 *     database whose name looks like staging or production.
 *   * Refuses a database name that does not look disposable (this first
 *     implementation is local-disposable only).
 *   * Verifies the connected database identity and host before scanning.
 *   * A staging-looking name can be relaxed only by an exact-name opt-in
 *     (`--allow-database <name>` / `ATLAS_BACKFILL_ALLOW_DATABASE`). The
 *     allowlist relaxes only the staging-name and disposable-name heuristics:
 *     local host, `DATABASE_URL` equality, `current_database()`, and
 *     loopback/socket verification are never bypassed, and production-patterned
 *     names (`prod`, `production`, `live`) are refused unconditionally.
 *   * After connecting, verifies the required read-path schema exists before
 *     enumerating anything. Missing objects abort with exit code 1 and are
 *     never created or migrated by this tool.
 *
 * Usage:
 *   node scripts/dev/embedding-backfill.mjs --dry-run \
 *     --database-url postgresql:///atlas_backfill_test?host=/tmp
 *
 *   ATLAS_BACKFILL_DATABASE_URL=postgresql:///atlas_backfill_test?host=/tmp \
 *     node scripts/dev/embedding-backfill.mjs --dry-run --json --limit 50
 *
 *   node scripts/dev/embedding-backfill.mjs --dry-run \
 *     --database-url 'postgresql:///atlas_rag_staging?host=/tmp' \
 *     --allow-database atlas_rag_staging
 *
 * Exit codes:
 *   0  Full scan completed; every eligible document was inspected.
 *   1  Invalid configuration, unsafe target, or a fatal scan failure.
 *   2  Scan completed but is incomplete (a `--limit` truncated it, or one or
 *      more documents could not be inspected). Never reported as a full scan.
 */

export const BACKFILL_DB_ENV = 'ATLAS_BACKFILL_DATABASE_URL';
export const ALLOW_DATABASE_ENV = 'ATLAS_BACKFILL_ALLOW_DATABASE';
export const TARGET_SPACE_ID = VOYAGE_SPACE.id;
export const DEFAULT_PAGE_SIZE = 100;

const SAFE_DB_PATTERN = /(disposable|test|scratch|sandbox)/i;
const STAGING_DB_PATTERN = /(staging|stage|_stg)/i;
const PRODUCTION_DB_PATTERN = /(prod|production|live)/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);
const WRITE_FLAGS = new Set(['--execute', '--apply', '--write', '--commit', '--no-dry-run']);

/**
 * Tables the dry-run query path genuinely needs. `documents` and `chunks` back
 * enumeration and chunk counting; `chunk_embeddings` backs the missing-embedding
 * lookup; `embedding_backfill_progress` completes the backfill runner's surface.
 * Identified by inspecting the repository queries the tool reaches.
 */
export const REQUIRED_SCHEMA_TABLES = [
  { name: 'documents', migration: null },
  { name: 'chunks', migration: 'database/migrations/20260530_create_chunks_table.sql' },
  { name: 'chunk_embeddings', migration: 'database/migrations/20261017_create_chunk_embeddings.sql' },
  { name: 'embedding_backfill_progress', migration: 'database/migrations/20261017_create_embedding_backfill_progress.sql' }
];

export const USAGE = `Atlas embedding-backfill dry-run (read-only)

Usage:
  node scripts/dev/embedding-backfill.mjs --dry-run [options]

Required:
  --dry-run                 Confirm the read-only inspection (this tool has no write mode).

Options:
  --database-url <url>      Explicit target database. Falls back to ${BACKFILL_DB_ENV}.
  --allow-database <name>   Opt in to one exact non-disposable database name
                            (repeatable). Also ${ALLOW_DATABASE_ENV} (comma-separated).
  --limit <n>               Inspect at most n eligible documents (bounded).
  --page-size <n>           Documents fetched per batch (default ${DEFAULT_PAGE_SIZE}).
  --json                    Emit machine-readable JSON instead of text.
  --help                    Show this message.

Safety:
  * Only a local database is accepted (non-DATABASE_URL). By default the name must
    look disposable (/(disposable|test|scratch|sandbox)/i).
  * A staging-looking name is refused unless it is explicitly allowlisted by exact
    name. Allowlisting never bypasses host, DATABASE_URL, identity, or
    loopback/socket checks; production-patterned names stay refused.
  * A read-only schema preflight runs after connecting; missing required tables
    abort with exit code 1 (nothing is created or migrated).
  * Point-in-time: concurrent ingestion can change the result after the report.
  * This command performs no writes and calls no embedding provider.
`;

/**
 * Parse CLI arguments. Throws on unknown arguments, explicit write flags, a
 * missing `--dry-run`, or a non-positive `--limit`/`--page-size`.
 */
export function parseArgs(argv) {
  const args = {
    help: false,
    dryRun: false,
    json: false,
    limit: null,
    pageSize: DEFAULT_PAGE_SIZE,
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

    if (WRITE_FLAGS.has(token)) {
      throw new ValidationError(
        `"${token}" is not supported: this tool is read-only and has no write mode.`
      );
    }

    switch (token) {
      case '--help':
        args.help = true;
        break;

      case '--dry-run':
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
          throw new ValidationError('--allow-database requires a non-empty database name.');
        }

        args.allowDatabases.push(value.trim());
        break;
      }

      case '--limit': {
        const value = Number(next());

        if (!Number.isInteger(value) || value <= 0) {
          throw new ValidationError('--limit must be a positive integer.');
        }

        args.limit = value;
        break;
      }

      case '--page-size': {
        const value = Number(next());

        if (!Number.isInteger(value) || value <= 0) {
          throw new ValidationError('--page-size must be a positive integer.');
        }

        args.pageSize = value;
        break;
      }

      default:
        throw new ValidationError(`Unknown argument: ${token}`);
    }
  }

  if (!args.help && !args.dryRun) {
    throw new ValidationError('This tool is dry-run only. Re-run with --dry-run.');
  }

  return args;
}

/**
 * Collect the explicitly allowlisted database names from repeatable CLI flags
 * and a comma-separated environment value. Exact-match only.
 *
 * @returns {Set<string>}
 */
export function resolveAllowlist({ args = {}, env = {} } = {}) {
  const allowlist = new Set();
  const fromArgs = Array.isArray(args.allowDatabases) ? args.allowDatabases : [];

  for (const name of fromArgs) {
    if (typeof name === 'string' && name.trim().length > 0) {
      allowlist.add(name.trim());
    }
  }

  const fromEnv = env[ALLOW_DATABASE_ENV];

  if (typeof fromEnv === 'string') {
    for (const part of fromEnv.split(',')) {
      const trimmed = part.trim();

      if (trimmed.length > 0) {
        allowlist.add(trimmed);
      }
    }
  }

  return allowlist;
}

/**
 * Resolve and validate the target database. Returns a descriptor or throws.
 *
 * Never falls back to `DATABASE_URL`. Refuses a target identical to
 * `DATABASE_URL`, a non-local host, a production-looking name, or a name that
 * does not look disposable. A staging-looking name is refused unless it appears
 * in the exact-name allowlist; the allowlist never relaxes the local-host,
 * `DATABASE_URL` equality, identity, or production checks.
 */
export function resolveTarget({ args = {}, env = process.env } = {}) {
  const raw = args.databaseUrl || env[BACKFILL_DB_ENV];

  if (!raw) {
    throw new ValidationError(
      `No target database provided. Pass --database-url or set ${BACKFILL_DB_ENV}. `
      + 'This tool never falls back to DATABASE_URL.'
    );
  }

  if (env.DATABASE_URL && raw === env.DATABASE_URL) {
    throw new ValidationError('Refusing to run: target URL is identical to DATABASE_URL (production).');
  }

  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError(`Refusing to run: ${BACKFILL_DB_ENV} is not a valid URL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const host = parsed.hostname;
  const port = parsed.port || '5432';

  if (!LOCAL_HOSTS.has(host)) {
    throw new ValidationError(
      `Refusing to run: host "${host}" is not local. This tool only reads a disposable local database.`
    );
  }

  const allowlist = resolveAllowlist({ args, env });
  const allowlisted = allowlist.has(database);

  if (PRODUCTION_DB_PATTERN.test(database)) {
    throw new ValidationError(
      `Refusing to run: database name "${database}" looks like staging or production. `
      + 'Production-patterned names are refused even when explicitly allowlisted.'
    );
  }

  if (!allowlisted && STAGING_DB_PATTERN.test(database)) {
    throw new ValidationError(
      `Refusing to run: database name "${database}" looks like staging or production. `
      + `Allowlist it explicitly with --allow-database or ${ALLOW_DATABASE_ENV} if it is a local copy.`
    );
  }

  if (!allowlisted && !SAFE_DB_PATTERN.test(database)) {
    throw new ValidationError(
      `Refusing to run: database name "${database}" does not look disposable `
      + `(expected it to match ${SAFE_DB_PATTERN}). `
      + `Allowlist it explicitly with --allow-database or ${ALLOW_DATABASE_ENV} if it is a local copy.`
    );
  }

  return {
    connectionString: raw,
    database,
    host,
    port,
    safeLabel: `${host || 'socket'}:${port}/${database}`,
    allowlist,
    allowlisted
  };
}

function splitAddress(address) {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const match = /^(.*)\/(\d{1,3})$/.exec(trimmed);

  if (!match) {
    return { base: trimmed, prefix: null };
  }

  const prefix = Number(match[2]);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    return null;
  }

  return { base: match[1], prefix };
}

function ipv4IsLoopback(dotted) {
  const firstOctet = Number(dotted.split('.')[0]);
  return firstOctet === 127;
}

/**
 * Parse an IPv6 literal into its 16 bytes. Returns null (fail closed) for
 * anything Node does not itself accept as IPv6. Handles `::` compression and an
 * embedded trailing IPv4 (`::ffff:127.0.0.1`).
 */
function ipv6ToBytes(address) {
  if (isIP(address) !== 6) {
    return null;
  }

  const doubleColon = address.indexOf('::');

  if (doubleColon !== -1 && address.indexOf('::', doubleColon + 2) !== -1) {
    return null;
  }

  const head = doubleColon === -1 ? address : address.slice(0, doubleColon);
  const tail = doubleColon === -1 ? '' : address.slice(doubleColon + 2);

  const parseGroups = (text) => {
    if (text.length === 0) {
      return [];
    }

    const groups = text.split(':');
    const bytes = [];

    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];

      if (group.includes('.')) {
        if (index !== groups.length - 1 || isIP(group) !== 4) {
          return null;
        }

        const octets = group.split('.').map(Number);

        if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
          return null;
        }

        bytes.push(octets[0], octets[1], octets[2], octets[3]);
        continue;
      }

      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        return null;
      }

      const value = parseInt(group, 16);
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }

    return bytes;
  };

  const headBytes = parseGroups(head);
  const tailBytes = parseGroups(tail);

  if (headBytes === null || tailBytes === null) {
    return null;
  }

  if (doubleColon !== -1) {
    const fill = 16 - headBytes.length - tailBytes.length;

    if (fill < 1) {
      return null;
    }

    return Uint8Array.from([...headBytes, ...new Array(fill).fill(0), ...tailBytes]);
  }

  if (headBytes.length !== 16) {
    return null;
  }

  return Uint8Array.from(headBytes);
}

/**
 * Whether an address reported by the server is loopback. Accepts IPv4
 * `127.0.0.0/8`, IPv6 `::1` (with or without a `/128` suffix, as PostgreSQL
 * returns over IPv6 TCP), and IPv4-mapped IPv6 (`::ffff:127.x.y.z`). Anything it
 * cannot parse confidently is treated as non-loopback (fail closed).
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') {
    return false;
  }

  const parsed = splitAddress(address);

  if (!parsed) {
    return false;
  }

  const family = isIP(parsed.base);

  if (family === 4) {
    if (parsed.prefix !== null && parsed.prefix > 32) {
      return false;
    }

    return ipv4IsLoopback(parsed.base);
  }

  if (family === 6) {
    const bytes = ipv6ToBytes(parsed.base);

    if (!bytes) {
      return false;
    }

    const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
      && bytes[10] === 0xff
      && bytes[11] === 0xff;

    if (isIpv4Mapped) {
      return bytes[12] === 127;
    }

    const isIpv6Loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
    return isIpv6Loopback;
  }

  return false;
}

/**
 * Verify, from the live connection, that we reached the expected local,
 * disposable database before scanning. Throws otherwise.
 *
 * The allowlist is re-evaluated against the connected database name (exact
 * match), so an allowlist entry can never authorize a different database.
 */
export async function verifyTarget(pool, target) {
  const { rows } = await pool.query(
    'SELECT current_database() AS database, inet_server_addr()::text AS server_addr'
  );
  const row = rows[0] ?? {};

  if (row.database !== target.database) {
    throw new ValidationError(
      `Refusing to run: connected to database "${row.database}" but target was "${target.database}".`
    );
  }

  if (PRODUCTION_DB_PATTERN.test(row.database)) {
    throw new ValidationError(
      `Refusing to run: connected database "${row.database}" looks like staging or production. `
      + 'Production-patterned names are refused even when explicitly allowlisted.'
    );
  }

  const allowlisted = target.allowlist instanceof Set && target.allowlist.has(row.database);

  if (!allowlisted && STAGING_DB_PATTERN.test(row.database)) {
    throw new ValidationError(`Refusing to run: connected database "${row.database}" looks like staging or production.`);
  }

  if (row.server_addr !== null && row.server_addr !== undefined && !isLoopbackAddress(row.server_addr)) {
    throw new ValidationError(
      `Refusing to run: connected to non-local server address "${row.server_addr}".`
    );
  }

  return row;
}

/**
 * Read-only preflight: confirm the tables the dry-run query path needs exist in
 * `public`. Throws (before any enumeration or planning) listing every missing
 * object and its migration, where known. Never creates or migrates anything.
 */
export async function preflightSchema(pool) {
  const placeholders = REQUIRED_SCHEMA_TABLES.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await pool.query(
    `SELECT obj AS name, to_regclass('public.' || obj) IS NOT NULL AS present
       FROM unnest(ARRAY[${placeholders}]::text[]) AS obj`,
    REQUIRED_SCHEMA_TABLES.map((entry) => entry.name)
  );

  const present = new Map((rows ?? []).map((row) => [row.name, row.present === true]));
  const missing = REQUIRED_SCHEMA_TABLES.filter((entry) => present.get(entry.name) !== true);

  if (missing.length > 0) {
    const detail = missing
      .map((entry) => (entry.migration ? `${entry.name} (${entry.migration})` : entry.name))
      .join(', ');

    throw new ValidationError(
      `Refusing to run: required schema is missing: ${detail}. `
      + 'Apply the migration(s) manually; this tool never modifies the database.'
    );
  }

  return { missing: [] };
}

function sanitizeMessage(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = message.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();

  if (cleaned.length === 0) {
    return 'Inspection failed.';
  }

  return cleaned.length > 300 ? `${cleaned.slice(0, 299).trimEnd()}…` : cleaned;
}

async function inspectDocument(runner, key, documents, errors, logger) {
  const status = key.status ?? null;

  try {
    const plan = await runner.planDocument(key.documentId);

    if (!plan) {
      documents.push({
        documentId: key.documentId,
        status,
        totalChunks: null,
        embeddedChunks: null,
        missingChunks: null,
        complete: null,
        needsWork: null,
        inspectError: 'document-not-found'
      });
      errors.push({ documentId: key.documentId, message: 'Document could not be inspected (not found at inspection time).' });
      return;
    }

    documents.push({
      documentId: plan.documentId,
      status,
      totalChunks: plan.totalChunks,
      embeddedChunks: plan.embeddedChunks,
      missingChunks: plan.missingChunks,
      complete: plan.complete,
      needsWork: plan.missingChunks > 0,
      inspectError: null
    });
  } catch (error) {
    const message = sanitizeMessage(error);
    documents.push({
      documentId: key.documentId,
      status,
      totalChunks: null,
      embeddedChunks: null,
      missingChunks: null,
      complete: null,
      needsWork: null,
      inspectError: message
    });
    errors.push({ documentId: key.documentId, message });

    if (logger && typeof logger.error === 'function') {
      logger.error(`Failed to inspect document ${key.documentId}: ${message}`);
    }
  }
}

/**
 * Walk the eligible documents in bounded pages and plan each one.
 *
 * `enumerate` is a read-only `{ limit, afterId } => Promise<[{ documentId, status }]>`
 * function. `runner` only needs `planDocument()`. Every inspected document adds
 * one entry to `documents`; failures add an entry to `errors` and mark the scan
 * incomplete.
 */
export async function runDryRun({
  enumerate,
  runner,
  spaceId = TARGET_SPACE_ID,
  limit = null,
  pageSize = DEFAULT_PAGE_SIZE,
  now = () => new Date(),
  logger = console
} = {}) {
  if (typeof enumerate !== 'function') {
    throw new ValidationError('A document enumerator is required.');
  }

  if (!runner || typeof runner.planDocument !== 'function') {
    throw new ValidationError('A backfill runner exposing planDocument() is required.');
  }

  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new ValidationError('"limit" must be null or a positive integer.');
  }

  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new ValidationError('"pageSize" must be a positive integer.');
  }

  const documents = [];
  const errors = [];
  let afterId = null;
  let eligible = 0;
  let truncated = false;

  while (limit === null || eligible < limit) {
    const remaining = limit === null ? pageSize : Math.min(pageSize, limit - eligible);
    const page = await enumerate({ limit: remaining, afterId });

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    for (const key of page) {
      eligible += 1;
      await inspectDocument(runner, key, documents, errors, logger);
    }

    afterId = page[page.length - 1].documentId;

    if (limit !== null && eligible >= limit) {
      const more = await enumerate({ limit: 1, afterId });
      truncated = Array.isArray(more) && more.length > 0;
      break;
    }

    if (page.length < remaining) {
      break;
    }
  }

  const inspected = documents.filter((document) => document.inspectError === null);
  const complete = inspected.filter((document) => document.complete === true);
  const incomplete = inspected.filter((document) => document.complete === false);
  const sum = (list, field) => list.reduce((total, document) => total + (Number(document[field]) || 0), 0);

  return {
    tool: 'atlas-embedding-backfill',
    mode: 'dry-run',
    readOnly: true,
    allowlistedTarget: false,
    spaceId,
    generatedAt: now().toISOString(),
    pointInTime: true,
    note: 'Point-in-time inspection. Concurrent ingestion or a backfill can change these results '
      + 'after this report is generated. This command performs no writes and calls no embedding provider.',
    limit,
    pageSize,
    eligibleDocuments: documents.length,
    inspectedDocuments: inspected.length,
    completeDocuments: complete.length,
    incompleteDocuments: incomplete.length,
    uninspectableDocuments: errors.length,
    documentsNeedingWork: incomplete.length,
    totalChunks: sum(inspected, 'totalChunks'),
    embeddedChunks: sum(inspected, 'embeddedChunks'),
    missingChunks: sum(inspected, 'missingChunks'),
    truncated,
    scanComplete: !truncated && errors.length === 0,
    documents,
    errors
  };
}

export function formatJsonReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function documentLine(document) {
  if (document.inspectError) {
    return `  ${document.documentId}  status=${document.status ?? 'unknown'}  `
      + `UNINSPECTABLE (${document.inspectError})`;
  }

  const verdict = document.complete ? 'complete' : 'NEEDS WORK';
  return `  ${document.documentId}  status=${document.status ?? 'unknown'}  `
    + `chunks=${document.totalChunks}  embedded=${document.embeddedChunks}  `
    + `missing=${document.missingChunks}  ${verdict}`;
}

export function formatTextReport(report) {
  const lines = [];

  lines.push('Atlas embedding backfill — DRY RUN (read-only)');
  lines.push(`Target:    ${report.target ?? '(unspecified)'}`);
  lines.push(`Space:     ${report.spaceId}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('Point-in-time inspection. Concurrent ingestion or a backfill can change these');
  lines.push('results after the report is generated. No writes, no provider calls.');

  if (report.allowlistedTarget) {
    lines.push('');
    lines.push(`WARNING: target "${report.target}" was explicitly allowlisted and is NOT a`);
    lines.push('disposable-named database. Confirm it is a local copy before relying on these results.');
  }

  lines.push('');
  lines.push(`Documents (${report.documents.length}):`);

  if (report.documents.length === 0) {
    lines.push('  (none)');
  } else {
    for (const document of report.documents) {
      lines.push(documentLine(document));
    }
  }

  lines.push('');
  lines.push('Aggregates:');
  lines.push(`  Eligible documents:     ${report.eligibleDocuments}`);
  lines.push(`  Complete:               ${report.completeDocuments}`);
  lines.push(`  Incomplete (need work): ${report.incompleteDocuments}`);
  lines.push(`  Uninspectable:          ${report.uninspectableDocuments}`);
  lines.push(`  Total chunks:           ${report.totalChunks}`);
  lines.push(`  Embedded chunks:        ${report.embeddedChunks}`);
  lines.push(`  Missing chunks:         ${report.missingChunks}`);

  if (report.truncated) {
    lines.push('');
    lines.push(`WARNING: partial scan — --limit ${report.limit} was reached; more eligible documents exist.`);
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push(`WARNING: ${report.errors.length} document(s) could not be inspected:`);

    for (const error of report.errors) {
      lines.push(`  ${error.documentId}: ${error.message}`);
    }
  }

  lines.push('');
  lines.push(`Result: ${report.scanComplete ? 'COMPLETE' : 'INCOMPLETE'}`);

  return `${lines.join('\n')}\n`;
}

function createThrowingProvider() {
  const refuse = () => {
    throw new Error('The dry-run inspector must never call an embedding provider.');
  };

  return { embedMany: refuse, embedManyWithUsage: refuse };
}

/**
 * Build the backfill runner wired to real repositories but a provider that
 * throws if it is ever called. `planDocument()` is read-only and never reaches
 * the provider, so the write paths are unreachable from this tool.
 */
export function createReadOnlyRunner(pool, { logger = console, embeddingProvider = createThrowingProvider() } = {}) {
  return createEmbeddingBackfillRunner({
    pool,
    documentsRepository: new DocumentsRepository(pool),
    embeddingRepository: new EmbeddingRepository(pool),
    chunkEmbeddingRepository: new ChunkEmbeddingRepository(pool),
    embeddingBackfillProgressRepository: new EmbeddingBackfillProgressRepository(pool),
    embeddingProvider,
    space: VOYAGE_SPACE,
    logger
  });
}

async function closePool(pool) {
  if (pool && typeof pool.end === 'function') {
    await pool.end();
  }
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
  const createRunner = deps.createRunner ?? ((pool) => createReadOnlyRunner(pool, { logger }));

  let args;

  try {
    args = parseArgs(argv);
  } catch (error) {
    writeError(`embedding-backfill: ${error.message}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  if (args.help) {
    write(USAGE);
    return { exitCode: 0, report: null, output: USAGE };
  }

  let target;

  try {
    target = resolveTarget({ args, env });
  } catch (error) {
    writeError(`embedding-backfill: ${error.message}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  let pool;

  try {
    pool = createPool(target);
  } catch (error) {
    writeError(`embedding-backfill: ${error.message}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  let report;

  try {
    try {
      await verifyTarget(pool, target);
      await preflightSchema(pool);

      const reconciliation = createEnumerator(pool);

      if (!reconciliation || typeof reconciliation.listReadyDocuments !== 'function') {
        throw new ValidationError('The document enumerator does not support listReadyDocuments().');
      }

      const runner = createRunner(pool);
      const enumerate = ({ limit, afterId }) => reconciliation.listReadyDocuments({ limit, afterId });

      report = await runDryRun({
        enumerate,
        runner,
        spaceId: TARGET_SPACE_ID,
        limit: args.limit,
        pageSize: args.pageSize,
        now,
        logger
      });
      report.target = target.safeLabel;
      report.allowlistedTarget = target.allowlisted === true;
    } finally {
      await closePool(pool);
    }
  } catch (error) {
    writeError(`embedding-backfill: ${sanitizeMessage(error)}\n`);
    return { exitCode: 1, report: null, output: null };
  }

  const output = args.json ? formatJsonReport(report) : formatTextReport(report);
  write(output);

  return { exitCode: report.scanComplete ? 0 : 2, report, output };
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
      process.stderr.write(`embedding-backfill: ${sanitizeMessage(error)}\n`);
      process.exitCode = 1;
    });
}
