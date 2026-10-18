import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { Pool } from 'pg';

import { chunkText } from '../../server/ingestion/chunkText.js';
import { ChunkRepository } from '../../server/ingestion/chunkRepository.js';
import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import { assertRuntimeConfigMatchesManifest } from '../../server/embeddings/embeddingManifest.js';

const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;
const DEFAULT_CORPUS = new URL('./fixtures/staging-corpus.json', import.meta.url);
const DEFAULT_OUT = new URL('./fixtures/staging-retrieval-cases.resolved.json', import.meta.url);

function parseArgs(argv) {
  const args = { databaseUrl: null, corpus: DEFAULT_CORPUS, out: DEFAULT_OUT, userId: 'staging-user' };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];

    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--corpus': args.corpus = next(); break;
      case '--out': args.out = next(); break;
      case '--user-id': args.userId = next(); break;
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

  return { connectionString: raw, safeLabel: `${parsed.hostname}:${parsed.port || '5432'}/${database}` };
}

function toSqlVector(vector) {
  return `[${vector.join(',')}]`;
}

async function upsertDocument(pool, { document, userId }) {
  // A seeded document must not be `ready` before its chunks exist and are
  // embedded. Seed it as `chunking`; readiness is published only by
  // `markDocumentReady` once every current chunk has an embedding.
  await pool.query(
    `
      INSERT INTO documents (id, user_id, file_name, file_type, file_size_bytes, storage_path, extracted_text, source_type, status, progress, ready_at, updated_at)
      VALUES ($1, $2, $3, 'text/plain', $4, NULL, $5, 'upload', 'chunking', 0, NULL, now())
      ON CONFLICT (id)
      DO UPDATE SET user_id = EXCLUDED.user_id,
                    file_name = EXCLUDED.file_name,
                    file_size_bytes = EXCLUDED.file_size_bytes,
                    extracted_text = EXCLUDED.extracted_text,
                    status = 'chunking',
                    progress = 0,
                    ready_at = NULL,
                    updated_at = now();
    `,
    [document.id, userId, document.fileName, Buffer.byteLength(document.text, 'utf8'), document.text]
  );
}

async function replaceChunks(chunkRepository, { documentId, chunks }) {
  // Delegate to the shared chunk-replacement path so seeding takes the document
  // row lock and invalidates stale `embedding_backfill_progress` rows in the same
  // transaction. A raw DELETE here could otherwise leave a completed progress row
  // pointing at a chunk set that no longer exists.
  return chunkRepository.replaceDocumentChunks(documentId, chunks);
}

async function markDocumentReady(pool, documentId) {
  // Publish readiness only after every current chunk has a legacy embedding, and
  // only in a single guarded statement (mirrors the orchestrator's readiness
  // invariant for the seed's legacy BGE path). Refuses — and throws — if any
  // chunk is still unembedded, so the seed can never create an invalid `ready`
  // document even if the embedding loop is interrupted.
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
            AND embedding IS NULL
        )
      RETURNING id
    `,
    [documentId]
  );

  if (result.rowCount !== 1) {
    throw new Error(`Refusing to mark ${documentId} ready: it still has chunks without embeddings.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const target = resolveTarget({ args, env });
  const corpus = JSON.parse(await readFile(args.corpus, 'utf8'));

  assertRuntimeConfigMatchesManifest(env);
  const provider = createEmbeddingProvider({ providerName: 'local' });
  const pool = new Pool({ connectionString: target.connectionString, ssl: false });
  const chunkRepository = new ChunkRepository(pool);

  const summary = {
    target: target.safeLabel,
    userId: args.userId,
    documents: [],
    embeddedChunks: 0,
    spaces: { baseline: 'bge-small-en-v1.5-mean-l2-int8-v1', baselineDimensions: 384 }
  };

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

    for (const document of corpus.documents) {
      await upsertDocument(pool, { document, userId: args.userId });

      const chunks = chunkText(document.text);
      const stored = await replaceChunks(chunkRepository, { documentId: document.id, chunks });
      const vectors = await provider.embedMany(stored.map((c) => c.content));

      if (vectors.length !== stored.length) {
        throw new Error(`Embedding count mismatch for ${document.fileName}.`);
      }

      for (let i = 0; i < stored.length; i += 1) {
        if (vectors[i].length !== 384) {
          throw new Error(`Unexpected BGE embedding dimension ${vectors[i].length}.`);
        }

        await pool.query('UPDATE chunks SET embedding = $2::vector WHERE id = $1;', [stored[i].id, toSqlVector(vectors[i])]);
      }

      await markDocumentReady(pool, document.id);

      summary.documents.push({ id: document.id, fileName: document.fileName, chunks: stored.length });
      summary.embeddedChunks += stored.length;
      console.log(`  seeded ${document.fileName} (${stored.length} chunks, 384-d)`);
    }

    const { rows: chunkRows } = await pool.query('SELECT id, document_id, chunk_index, content FROM chunks ORDER BY document_id, chunk_index;');
    const resolvedCases = [];

    for (const testCase of corpus.cases) {
      if (testCase.expectNoAnswer) {
        resolvedCases.push({ id: testCase.id, kind: testCase.kind, query: testCase.query, expectNoAnswer: true, maxSimilarity: testCase.maxSimilarity ?? 0.5 });
        continue;
      }

      const documentIds = new Set(testCase.expectedDocumentIds ?? []);
      const chunkIndices = new Set(testCase.expectedChunkIndices ?? []);

      for (const marker of testCase.markers ?? []) {
        const matches = chunkRows.filter((row) => row.content.includes(marker));

        if (matches.length === 0) {
          throw new Error(`Marker not found in any chunk: "${marker}" (case ${testCase.id}).`);
        }

        for (const match of matches) {
          documentIds.add(match.document_id);
          chunkIndices.add(Number(match.chunk_index));
        }
      }

      resolvedCases.push({
        id: testCase.id,
        kind: testCase.kind,
        query: testCase.query,
        expectedDocumentIds: [...documentIds],
        expectedChunkIndices: [...chunkIndices]
      });
    }

    await writeFile(args.out, `${JSON.stringify(resolvedCases, null, 2)}\n`, 'utf8');
    summary.resolvedCases = resolvedCases.length;
    summary.out = String(args.out);

    console.log(JSON.stringify(summary, null, 2));
    console.log('SEED RESULT: OK');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`seed-staging-corpus: ${error.message}`);
  process.exitCode = 1;
});
