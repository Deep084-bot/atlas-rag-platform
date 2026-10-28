import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { Pool } from 'pg';

import { chunkText } from '../../server/ingestion/chunkText.js';
import { EmbeddingRepository } from '../../server/embeddings/embeddingRepository.js';
import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { assertRuntimeConfigMatchesManifest } from '../../server/embeddings/embeddingManifest.js';
import { resolveEmbeddingSpaceForProvider } from '../../server/embeddings/embeddingSpaces.js';

/**
 * Seeds ONLY the new ("action": "seed") documents of the retrieval-evaluation
 * plan into a disposable staging database, leaving every pre-existing document
 * and chunk untouched. It never issues a DELETE. Cases are resolved to concrete
 * chunk indices by querying the database, so labels always point at real chunks.
 *
 * The default target is never inferred from DATABASE_URL.
 */

const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;
const DEFAULT_PLAN = new URL('./fixtures/retrieval-eval-plan.json', import.meta.url);
const DEFAULT_OUT = new URL('./fixtures/retrieval-eval-cases.resolved.json', import.meta.url);

function parseArgs(argv) {
  const args = {
    databaseUrl: null,
    plan: DEFAULT_PLAN,
    out: DEFAULT_OUT,
    userId: 'staging-user',
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];
    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--plan': args.plan = next(); break;
      case '--out': args.out = next(); break;
      case '--user-id': args.userId = next(); break;
      case '--dry-run': args.dryRun = true; break;
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
    throw new Error('Refusing to run: target URL is identical to DATABASE_URL (production).');
  }

  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!SAFE_DB_PATTERN.test(database)) {
    throw new Error(`Refusing to run: database name "${database}" does not look like a staging/disposable target.`);
  }

  return { connectionString: raw, safeLabel: `${parsed.hostname}:${parsed.port || '5432'}/${database}`, database };
}

async function documentExists(pool, id) {
  const { rows } = await pool.query('SELECT file_name FROM documents WHERE id = $1;', [id]);
  return rows[0] ?? null;
}

async function insertDocument(pool, { document, userId }) {
  await pool.query(
    `
      INSERT INTO documents (id, user_id, file_name, file_type, file_size_bytes, storage_path, extracted_text, source_type, status, progress, ready_at, updated_at)
      VALUES ($1, $2, $3, 'text/plain', $4, NULL, $5, 'upload', 'chunking', 0, NULL, now());
    `,
    [document.id, userId, document.fileName, Buffer.byteLength(document.text, 'utf8'), document.text]
  );
}

async function insertChunks(pool, { documentId, chunks }) {
  const stored = [];

  for (const chunk of chunks) {
    const { rows } = await pool.query(
      `
        INSERT INTO chunks (document_id, chunk_index, content, character_count)
        VALUES ($1, $2, $3, $4)
        RETURNING id, chunk_index;
      `,
      [documentId, chunk.chunkIndex, chunk.content, chunk.characterCount]
    );
    stored.push(rows[0]);
  }

  return stored;
}

async function markDocumentReady(pool, documentId, spaceId) {
  const result = await pool.query(
    `
      UPDATE documents
      SET status = 'ready',
          progress = 100,
          failure_reason = NULL,
          ready_at = now(),
          updated_at = now()
      WHERE id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM chunks
          WHERE document_id = $1
            AND (embedding IS NULL OR embedding_space_id IS DISTINCT FROM $2)
        )
      RETURNING id
    `,
    [documentId, spaceId]
  );

  if (result.rowCount !== 1) {
    throw new Error(`Refusing to mark ${documentId} ready: it still has chunks without embeddings for space ${spaceId}.`);
  }
}

async function resolveMarkersFromDb(pool, { documentId, marker }) {
  const { rows } = await pool.query(
    'SELECT chunk_index FROM chunks WHERE document_id = $1 AND position($2 in content) > 0 ORDER BY chunk_index;',
    [documentId, marker]
  );
  return rows.map((row) => Number(row.chunk_index));
}

async function resolveCases(pool, cases) {
  const resolved = [];

  for (const testCase of cases) {
    if (testCase.expectNoAnswer) {
      resolved.push({ id: testCase.id, kind: testCase.kind ?? null, query: testCase.query, expectNoAnswer: true });
      continue;
    }

    const byChunk = new Map();

    for (const rel of testCase.relevance ?? []) {
      const indices = await resolveMarkersFromDb(pool, { documentId: rel.documentId, marker: rel.marker });

      if (indices.length === 0) {
        throw new Error(`Case "${testCase.id}": marker not found in DB for ${rel.documentId}: "${rel.marker}"`);
      }

      const grade = rel.grade ?? 1;
      for (const chunkIndex of indices) {
        const key = `${rel.documentId}::${chunkIndex}`;
        if (!byChunk.has(key) || grade > byChunk.get(key).grade) {
          byChunk.set(key, { documentId: rel.documentId, chunkIndex, grade });
        }
      }
    }

    resolved.push({ id: testCase.id, kind: testCase.kind ?? null, query: testCase.query, relevance: [...byChunk.values()] });
  }

  return resolved;
}

function planSeeding(plan) {
  const seed = plan.documents.filter((doc) => (doc.action ?? 'seed') === 'seed');
  const reuse = plan.documents.filter((doc) => doc.action === 'reuse');
  return { seed, reuse };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const target = resolveTarget({ args, env });
  const plan = JSON.parse(await readFile(args.plan, 'utf8'));
  const { seed, reuse } = planSeeding(plan);

  if (!Array.isArray(plan.documents) || !Array.isArray(plan.cases)) {
    throw new Error('Plan must contain "documents" and "cases" arrays.');
  }

  const summary = {
    target: target.safeLabel,
    dryRun: args.dryRun,
    userId: args.userId,
    toSeed: seed.map((doc) => ({ id: doc.id, fileName: doc.fileName, chunks: chunkText(doc.text, plan.chunking).length })),
    reused: [],
    inserted: [],
    skipped: [],
    resolvedCases: 0,
    out: String(args.out)
  };

  if (args.dryRun) {
    const pool = new Pool({ connectionString: target.connectionString, ssl: false });
    try {
      for (const doc of reuse) {
        const existing = await documentExists(pool, doc.id);
        if (!existing) {
          throw new Error(`Reused document ${doc.id} is not present in ${target.safeLabel}.`);
        }
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id = $1;', [doc.id]);
        summary.reused.push({ id: doc.id, fileName: existing.file_name, chunks: rows[0].n });
      }
      for (const doc of seed) {
        const existing = await documentExists(pool, doc.id);
        summary.skipped.push({ id: doc.id, exists: Boolean(existing) });
      }
      summary.previewCases = previewCases(plan);
      summary.resolvedCases = summary.previewCases.length;
    } finally {
      await pool.end();
    }

    console.log(JSON.stringify(summary, null, 2));
    console.log('SEED EVAL CORPUS DRY-RUN: OK (no writes performed)');
    return;
  }

  assertRuntimeConfigMatchesManifest(env);
  const provider = createEmbeddingProvider({ providerName: 'local' });
  const space = resolveEmbeddingSpaceForProvider('local', env);
  const pool = new Pool({ connectionString: target.connectionString, ssl: false });
  const embeddingRepository = new EmbeddingRepository(pool);

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

    for (const doc of reuse) {
      const existing = await documentExists(pool, doc.id);
      if (!existing) {
        throw new Error(`Reused document ${doc.id} is not present in ${target.safeLabel}.`);
      }
    }

    for (const doc of seed) {
      const existing = await documentExists(pool, doc.id);

      if (existing) {
        if (existing.file_name !== doc.fileName) {
          throw new Error(`Document ${doc.id} already exists with a different file name (${existing.file_name}); refusing to overwrite.`);
        }
        summary.skipped.push({ id: doc.id, fileName: doc.fileName, reason: 'already present (not modified)' });
        console.log(`  skipped ${doc.fileName} (already present, untouched)`);
        continue;
      }

      await insertDocument(pool, { document: doc, userId: args.userId });
      const chunks = chunkText(doc.text, plan.chunking);
      const stored = await insertChunks(pool, { documentId: doc.id, chunks });
      const vectors = await provider.embedMany(stored.map(() => null).map((_, i) => chunks[i].content));

      if (vectors.length !== stored.length) {
        throw new Error(`Embedding count mismatch for ${doc.fileName}.`);
      }

      for (let i = 0; i < stored.length; i += 1) {
        if (vectors[i].length !== space.dimensions) {
          throw new Error(`Unexpected BGE embedding dimension ${vectors[i].length}; expected ${space.dimensions}.`);
        }

        const updated = await embeddingRepository.updateChunkEmbedding(stored[i].id, vectors[i], {
          spaceId: space.id
        });

        if (!updated) {
          throw new Error(`Chunk ${stored[i].id} disappeared before its ${space.id} embedding was persisted.`);
        }
      }

      await markDocumentReady(pool, doc.id, space.id);

      summary.inserted.push({ id: doc.id, fileName: doc.fileName, chunks: stored.length });
      console.log(`  seeded ${doc.fileName} (${stored.length} chunks, 384-d)`);
    }

    for (const doc of reuse) {
      const existing = await documentExists(pool, doc.id);
      if (!existing) {
        throw new Error(`Reused document ${doc.id} disappeared before resolution.`);
      }
      const expected = chunkText(doc.text, plan.chunking).length;
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM chunks WHERE document_id = $1;', [doc.id]);
      if (rows[0].n !== expected) {
        throw new Error(`Reused document ${doc.id} has ${rows[0].n} chunks in DB but the plan expects ${expected}. Aborting to avoid mismatched labels.`);
      }
      summary.reused.push({ id: doc.id, fileName: doc.fileName, chunks: rows[0].n });
    }

    const resolved = await resolveCases(pool, plan.cases);
    await writeFile(args.out, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
    summary.resolvedCases = resolved.length;

    console.log(JSON.stringify(summary, null, 2));
    console.log('SEED EVAL CORPUS: OK');
  } finally {
    await pool.end();
  }
}

function previewCases(plan) {
  return plan.cases.map((testCase) => {
    if (testCase.expectNoAnswer) {
      return { id: testCase.id, kind: testCase.kind ?? null, query: testCase.query, expectNoAnswer: true };
    }
    return {
      id: testCase.id,
      kind: testCase.kind ?? null,
      query: testCase.query,
      markers: (testCase.relevance ?? []).length
    };
  });
}

main().catch((error) => {
  console.error(`seed-eval-corpus: ${error.message}`);
  process.exitCode = 1;
});
