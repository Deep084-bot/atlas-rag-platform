import { URL } from 'node:url';

import { Pool } from 'pg';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { EMBEDDING_MANIFEST, assertRuntimeConfigMatchesManifest } from '../../server/embeddings/embeddingManifest.js';
import {
  BGE_SPACE_ID,
  VOYAGE_SPACE_ID,
  VOYAGE_MODEL_DEFAULT,
  getEmbeddingSpace,
  resolveEmbeddingSpaceForProvider,
  voyageSpaceId
} from '../../server/embeddings/embeddingSpaces.js';

const SHADOW_TABLE = 'embedding_shadow_chunks';
const PROGRESS_TABLE = 'embedding_migration_progress';
const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;

function parseArgs(argv) {
  const args = {
    databaseUrl: null,
    space: null,
    provider: 'local',
    dimensions: null,
    apply: false,
    dryRun: false,
    restart: false,
    confirmDisposable: false,
    allowCustomSpace: false,
    limit: null,
    batchSize: 8,
    delayMs: 0,
    query: null,
    expectedIndex: null,
    json: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];

    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--space': args.space = next(); break;
      case '--provider': args.provider = next(); break;
      case '--dimensions': args.dimensions = Number(next()); break;
      case '--limit': args.limit = Number(next()); break;
      case '--batch-size': args.batchSize = Number(next()); break;
      case '--delay-ms': args.delayMs = Number(next()); break;
      case '--query': args.query = next(); break;
      case '--expected-index': args.expectedIndex = Number(next()); break;
      case '--apply': args.apply = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--restart': args.restart = true; break;
      case '--confirm-disposable': args.confirmDisposable = true; break;
      case '--allow-custom-space': args.allowCustomSpace = true; break;
      case '--json': args.json = true; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function resolveTarget({ args, env }) {
  const raw = args.databaseUrl || env.MIGRATION_DATABASE_URL;

  if (!raw) {
    throw new Error('No target database provided. Pass --database-url or set MIGRATION_DATABASE_URL. This tool never falls back to DATABASE_URL.');
  }

  if (env.DATABASE_URL && raw === env.DATABASE_URL) {
    throw new Error('Refusing to run: target URL is identical to DATABASE_URL (production). Point at a dedicated staging/disposable database.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Refusing to run: target database URL is not a valid URL.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!SAFE_DB_PATTERN.test(database)) {
    throw new Error(`Refusing to run: database name "${database}" does not look like a staging/disposable target. Expected it to match ${SAFE_DB_PATTERN}.`);
  }

  return {
    connectionString: raw,
    safeLabel: `${parsed.hostname}:${parsed.port || '5432'}/${database}`
  };
}

function toSqlVector(vector) {
  return `[${vector.join(',')}]`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function l2norm(vector) {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(ql)?:\/\/[^\s]+/gi, 'postgres://<redacted>').slice(0, 300);
}

async function ensureSchemas(pool, { apply, dimensions }) {
  if (!apply) {
    return;
  }

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Cannot create shadow table: invalid dimensions ${dimensions}.`);
  }

  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SHADOW_TABLE} (
      space_id text NOT NULL,
      document_id uuid NOT NULL,
      chunk_index integer NOT NULL,
      source_chunk_id uuid,
      dimensions integer NOT NULL,
      l2_norm double precision NOT NULL,
      embedding vector(${dimensions}) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (space_id, document_id, chunk_index)
    );
  `);

  const existing = await pool.query(
    `SELECT format_type(atttypid, atttypmod) AS column_type
     FROM pg_attribute
     WHERE attrelid = '${SHADOW_TABLE}'::regclass AND attname = 'embedding' AND NOT attisdropped;`
  );
  const columnType = existing.rows[0]?.column_type;

  if (columnType && columnType !== `vector(${dimensions})`) {
    throw new Error(
      `Shadow table ${SHADOW_TABLE} already has embedding column type "${columnType}" but this run expects vector(${dimensions}). ` +
      `Drop the shadow table (staging only) or pass matching --dimensions/--provider.`
    );
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS ${SHADOW_TABLE}_space_idx ON ${SHADOW_TABLE} (space_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ${SHADOW_TABLE}_doc_idx ON ${SHADOW_TABLE} (space_id, document_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
      space_id text NOT NULL,
      document_id uuid NOT NULL,
      status text NOT NULL,
      chunk_count integer NOT NULL DEFAULT 0,
      failure_reason text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (space_id, document_id)
    );
  `);

  // Added after the initial tooling shipped; keep additive so existing staging
  // progress tables upgrade in place.
  await pool.query(`ALTER TABLE ${PROGRESS_TABLE} ADD COLUMN IF NOT EXISTS token_count integer NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ${PROGRESS_TABLE} ADD COLUMN IF NOT EXISTS tokens_available boolean NOT NULL DEFAULT false;`);
}

async function planMigration(pool, { space, limit }) {
  const totalDocs = await pool.query('SELECT COUNT(DISTINCT document_id)::int AS n FROM chunks;');
  const totalChunks = await pool.query('SELECT COUNT(*)::int AS n FROM chunks;');

  let pendingDocuments = totalDocs.rows[0].n;

  try {
    const pending = await pool.query(
      `
        SELECT COUNT(DISTINCT c.document_id)::int AS n
        FROM chunks c
        WHERE NOT EXISTS (
          SELECT 1 FROM ${PROGRESS_TABLE} p
          WHERE p.space_id = $1 AND p.document_id = c.document_id AND p.status = 'completed'
        );
      `,
      [space]
    );
    pendingDocuments = pending.rows[0].n;
  } catch {
    // Progress table does not exist yet (dry-run against a fresh database).
  }

  return {
    totalDocuments: totalDocs.rows[0].n,
    totalChunks: totalChunks.rows[0].n,
    pendingDocuments,
    limit: limit ?? null
  };
}

async function fetchPendingDocuments(pool, { space, limit }) {
  const { rows } = await pool.query(
    `
      SELECT DISTINCT c.document_id
      FROM chunks c
      WHERE NOT EXISTS (
        SELECT 1 FROM ${PROGRESS_TABLE} p
        WHERE p.space_id = $1 AND p.document_id = c.document_id AND p.status = 'completed'
      )
      ORDER BY c.document_id
      ${limit ? 'LIMIT $2' : ''};
    `,
    limit ? [space, limit] : [space]
  );

  return rows.map((r) => r.document_id);
}

async function fetchDocumentChunks(pool, documentId) {
  const { rows } = await pool.query(
    'SELECT id, chunk_index, content FROM chunks WHERE document_id = $1 ORDER BY chunk_index ASC;',
    [documentId]
  );

  return rows;
}

async function upsertShadowChunks(pool, { space, documentId, chunks, vectors }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const vector = vectors[i];
      const norm = l2norm(vector);

      await client.query(
        `
          INSERT INTO ${SHADOW_TABLE} (space_id, document_id, chunk_index, source_chunk_id, dimensions, l2_norm, embedding, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::vector, now())
          ON CONFLICT (space_id, document_id, chunk_index)
          DO UPDATE SET source_chunk_id = EXCLUDED.source_chunk_id,
                        dimensions = EXCLUDED.dimensions,
                        l2_norm = EXCLUDED.l2_norm,
                        embedding = EXCLUDED.embedding,
                        updated_at = now();
        `,
        [space, documentId, chunk.chunk_index, chunk.id, vector.length, norm, toSqlVector(vector)]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recordProgress(pool, { space, documentId, status, chunkCount, failureReason, tokenCount = 0, tokensAvailable = false }) {
  await pool.query(
    `
      INSERT INTO ${PROGRESS_TABLE} (space_id, document_id, status, chunk_count, failure_reason, token_count, tokens_available, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (space_id, document_id)
      DO UPDATE SET status = EXCLUDED.status,
                    chunk_count = EXCLUDED.chunk_count,
                    failure_reason = EXCLUDED.failure_reason,
                    token_count = EXCLUDED.token_count,
                    tokens_available = EXCLUDED.tokens_available,
                    updated_at = now();
    `,
    [space, documentId, status, chunkCount, failureReason ?? null, tokenCount, tokensAvailable]
  );
}

function readProviderUsage(provider) {
  if (provider && typeof provider.getUsageSnapshot === 'function') {
    return provider.getUsageSnapshot();
  }

  return null;
}

async function fetchCumulativeUsage(pool, space) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(token_count) FILTER (WHERE status = 'completed' AND tokens_available), 0)::int AS completed_tokens,
        COUNT(*) FILTER (WHERE status = 'completed' AND tokens_available)::int AS documents_with_usage,
        COUNT(*) FILTER (WHERE status = 'completed' AND NOT tokens_available)::int AS documents_without_usage,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS documents_completed
      FROM ${PROGRESS_TABLE}
      WHERE space_id = $1;
    `,
    [space]
  );

  const row = rows[0];
  const documentsWithUsage = row.documents_with_usage;
  const documentsWithoutUsage = row.documents_without_usage;

  return {
    completedTokens: documentsWithUsage > 0 ? row.completed_tokens : null,
    documentsWithUsage,
    documentsWithoutUsage,
    documentsCompleted: row.documents_completed,
    usageAvailable: documentsWithUsage > 0
  };
}

function documentUsageDelta(before, after) {
  if (!after || after.totalTokens === null) {
    return { tokenCount: 0, tokensAvailable: false };
  }

  const requestBefore = before ? before.requestCount : 0;
  const withoutBefore = before ? before.requestsWithoutUsage : 0;

  // No successful request for this document, or at least one response omitted
  // usage: the delta cannot be trusted, so record it as unavailable instead of
  // inventing a value.
  if (after.requestCount === requestBefore || after.requestsWithoutUsage !== withoutBefore) {
    return { tokenCount: 0, tokensAvailable: false };
  }

  const baseTokens = before && before.totalTokens !== null ? before.totalTokens : 0;

  return { tokenCount: Math.max(0, after.totalTokens - baseTokens), tokensAvailable: true };
}

async function validateVectors(pool, { space, dimensions }) {
  const { rows } = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE dimensions <> $2)::int AS bad_dims,
        COUNT(*) FILTER (WHERE l2_norm IS NULL OR abs(l2_norm - 1) > 0.01)::int AS bad_norm,
        COUNT(*) FILTER (WHERE embedding IS NULL)::int AS null_vectors,
        MIN(dimensions)::int AS min_dims,
        MAX(dimensions)::int AS max_dims
      FROM ${SHADOW_TABLE}
      WHERE space_id = $1;
    `,
    [space, dimensions]
  );

  const stats = rows[0];
  return {
    ...stats,
    ok: stats.total > 0 && stats.bad_dims === 0 && stats.bad_norm === 0 && stats.null_vectors === 0
  };
}

async function retrievalCheck(pool, { space, provider, query, expectedIndex }) {
  const queryVector = await provider.embed(query);
  const { rows } = await pool.query(
    `
      SELECT s.space_id, s.chunk_index, c.content,
             1 - (s.embedding <=> $2::vector) AS similarity
      FROM ${SHADOW_TABLE} s
      JOIN chunks c ON c.id = s.source_chunk_id
      WHERE s.space_id = $1
      ORDER BY s.embedding <=> $2::vector
      LIMIT 5;
    `,
    [space, toSqlVector(queryVector)]
  );

  const distinctSpaces = new Set(rows.map((r) => r.space_id));

  return {
    returnedSpaces: [...distinctSpaces],
    top: rows.map((r) => ({ spaceId: r.space_id, chunkIndex: r.chunk_index, similarity: Number(r.similarity.toFixed(4)), head: r.content.slice(0, 50).replace(/\s+/g, ' ') })),
    top1MatchesExpected: expectedIndex === null ? null : rows[0]?.chunk_index === expectedIndex
  };
}

function resolveSpaceSelection({ args, env }) {
  const providerName = (args.provider || 'local').trim().toLowerCase();

  if (!['local', 'voyage'].includes(providerName)) {
    throw new Error(`Unsupported --provider "${providerName}". Supported: local, voyage.`);
  }

  const baseSpace = resolveEmbeddingSpaceForProvider(providerName, env);
  const dimensions = Number.isFinite(args.dimensions) && args.dimensions > 0 ? args.dimensions : baseSpace.dimensions;

  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Invalid --dimensions "${args.dimensions}".`);
  }

  let spaceId;
  if (args.space) {
    spaceId = args.space;
  } else if (baseSpace.kind === 'voyage') {
    spaceId = voyageSpaceId(dimensions);
  } else {
    spaceId = baseSpace.id;
  }

  const known = getEmbeddingSpace(spaceId);
  const expectedVoyageId = voyageSpaceId(dimensions);

  if (!args.allowCustomSpace) {
    if (baseSpace.kind === 'voyage' && spaceId !== expectedVoyageId) {
      throw new Error(`Refusing to run: --space "${spaceId}" does not match the voyage space "${expectedVoyageId}". Pass --allow-custom-space to override explicitly.`);
    }
    if (baseSpace.kind !== 'voyage' && known === null) {
      throw new Error(`Refusing to run: --space "${spaceId}" is not a known embedding space. Pass --allow-custom-space to override explicitly.`);
    }
  }

  const spaceConfig = known ?? { ...baseSpace, id: spaceId, dimensions, derived: true };

  return {
    providerName,
    space: spaceId,
    dimensions,
    spaceConfig: {
      id: spaceConfig.id,
      kind: spaceConfig.kind,
      provider: spaceConfig.provider,
      model: spaceConfig.model,
      revision: spaceConfig.revision ?? null,
      dimensions: spaceConfig.dimensions,
      normalization: spaceConfig.normalization,
      queryInputType: spaceConfig.queryInputType ?? null,
      documentInputType: spaceConfig.documentInputType ?? null
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  if (args.apply === args.dryRun) {
    throw new Error('Choose exactly one mode: --dry-run or --apply.');
  }

  const target = resolveTarget({ args, env });
  const selection = resolveSpaceSelection({ args, env });
  const { providerName, space, dimensions } = selection;

  if (args.apply && !args.confirmDisposable) {
    throw new Error('Refusing to apply: pass --confirm-disposable to acknowledge the target is a staging/disposable database.');
  }

  const summary = {
    mode: args.dryRun ? 'dry-run' : 'apply',
    target: target.safeLabel,
    space,
    spaceConfig: selection.spaceConfig,
    manifestRevision: providerName === 'local' ? EMBEDDING_MANIFEST.model.revision : null,
    startedAt: new Date().toISOString()
  };

  const pool = new Pool({ connectionString: target.connectionString, ssl: false });

  try {
    await ensureSchemas(pool, { apply: args.apply, dimensions });

    if (args.restart && args.apply) {
      await pool.query(`DELETE FROM ${PROGRESS_TABLE} WHERE space_id = $1;`, [space]);
    }

    summary.plan = await planMigration(pool, { space, limit: args.limit });

    if (args.dryRun) {
      const before = await pool.query(`SELECT COUNT(*)::int AS n FROM ${SHADOW_TABLE} WHERE space_id = $1;`, [space]).catch(() => ({ rows: [{ n: 0 }] }));
      summary.shadowRowsForSpace = before.rows[0].n;
      summary.note = 'dry-run: no tables created, no vectors written, no progress recorded.';
      console.log(JSON.stringify(summary, null, 2));
      console.log('MIGRATION RESULT: DRY-RUN OK');
      return;
    }

    let provider;

    if (providerName === 'voyage') {
      if (!env.VOYAGE_API_KEY) {
        throw new Error('--provider voyage requires VOYAGE_API_KEY to be set.');
      }

      provider = new VoyageProvider({
        apiKey: env.VOYAGE_API_KEY,
        model: env.VOYAGE_MODEL || VOYAGE_MODEL_DEFAULT,
        baseUrl: env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1',
        dimensions,
        inputType: selection.spaceConfig.documentInputType,
        normalize: true
      });
      summary.provider = { name: 'voyage', model: provider.model, dimensions, documentInputType: selection.spaceConfig.documentInputType };
    } else {
      const config = assertRuntimeConfigMatchesManifest(env);

      if (config.dimensions !== dimensions) {
        throw new Error(`Local embedding runtime dimensions ${config.dimensions} do not match requested --dimensions ${dimensions}.`);
      }

      summary.runtime = { model: config.model, revision: config.revision ?? null, pooling: config.pooling, quantized: config.quantized };
      provider = createEmbeddingProvider({ providerName: 'local' });
    }

    const documents = await fetchPendingDocuments(pool, { space, limit: args.limit });

    summary.processing = { attempted: documents.length, completed: 0, failed: 0, chunksWritten: 0, delayMs: args.delayMs };

    for (const documentId of documents) {
      try {
        const chunks = await fetchDocumentChunks(pool, documentId);
        const usageBefore = readProviderUsage(provider);

        if (chunks.length === 0) {
          await recordProgress(pool, { space, documentId, status: 'completed', chunkCount: 0 });
          continue;
        }

        const vectors = [];

        for (let i = 0; i < chunks.length; i += args.batchSize) {
          const batch = chunks.slice(i, i + args.batchSize).map((c) => c.content);
          const batchVectors = await provider.embedMany(batch);
          vectors.push(...batchVectors);

          if (args.delayMs > 0) {
            await sleep(args.delayMs);
          }
        }

        await upsertShadowChunks(pool, { space, documentId, chunks, vectors });

        const usageDelta = documentUsageDelta(usageBefore, readProviderUsage(provider));

        await recordProgress(pool, {
          space,
          documentId,
          status: 'completed',
          chunkCount: chunks.length,
          tokenCount: usageDelta.tokenCount,
          tokensAvailable: usageDelta.tokensAvailable
        });

        summary.processing.completed += 1;
        summary.processing.chunksWritten += chunks.length;
        console.log(`  migrated document ${documentId} (${chunks.length} chunks)`);
      } catch (error) {
        const reason = sanitizeError(error);
        await recordProgress(pool, { space, documentId, status: 'failed', chunkCount: 0, failureReason: reason });
        summary.processing.failed += 1;
        console.log(`  FAILED document ${documentId}: ${reason}`);
      }
    }

    summary.usage = {
      provider: providerName,
      run: readProviderUsage(provider),
      cumulativeCompleted: await fetchCumulativeUsage(pool, space)
    };

    summary.validation = await validateVectors(pool, { space, dimensions });

    if (args.query) {
      summary.retrieval = await retrievalCheck(pool, { space, provider, query: args.query, expectedIndex: args.expectedIndex });
    }

    summary.finishedAt = new Date().toISOString();
    summary.passed = summary.validation.ok
      && summary.processing.failed === 0
      && (args.query ? summary.retrieval.returnedSpaces.length === 1 : true);

    console.log(JSON.stringify(summary, null, 2));
    console.log(summary.passed ? 'MIGRATION RESULT: PASS' : 'MIGRATION RESULT: FAIL');

    if (!summary.passed) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`embedding-migration: ${sanitizeError(error)}`);
  process.exitCode = 1;
});
