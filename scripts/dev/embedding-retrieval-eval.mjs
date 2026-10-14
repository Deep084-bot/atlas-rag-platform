import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { Pool } from 'pg';

import { createEmbeddingProvider } from '../../server/embeddings/createEmbeddingProvider.js';
import {
  EMBEDDING_MANIFEST,
  EMBEDDING_SPACE_ID,
  assertRuntimeConfigMatchesManifest
} from '../../server/embeddings/embeddingManifest.js';

const SHADOW_TABLE = 'embedding_shadow_chunks';
const SAFE_DB_PATTERN = /(staging|stage|disposable|test|scratch|sandbox|_stg)/i;

function parseArgs(argv) {
  const args = { databaseUrl: null, space: null, cases: null, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];

    switch (token) {
      case '--database-url': args.databaseUrl = next(); break;
      case '--space': args.space = next(); break;
      case '--cases': args.cases = next(); break;
      case '--json': args.json = true; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error('--cases <path-to-json> is required');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget({ args, env: process.env });
  const space = args.space || EMBEDDING_SPACE_ID;
  const cases = JSON.parse(await readFile(args.cases, 'utf8'));

  assertRuntimeConfigMatchesManifest();

  const provider = createEmbeddingProvider({ providerName: 'local' });
  const pool = new Pool({ connectionString: target.connectionString, ssl: false });

  const summary = {
    target: target.safeLabel,
    space,
    manifestRevision: EMBEDDING_MANIFEST.model.revision,
    cases: []
  };

  try {
    for (const testCase of cases) {
      const vector = await provider.embed(testCase.query);
      const { rows } = await pool.query(
        `
          SELECT s.space_id, s.document_id, s.chunk_index, c.content,
                 1 - (s.embedding <=> $2::vector) AS similarity
          FROM ${SHADOW_TABLE} s
          JOIN chunks c ON c.id = s.source_chunk_id
          WHERE s.space_id = $1
          ORDER BY s.embedding <=> $2::vector
          LIMIT 5;
        `,
        [space, toSqlVector(vector)]
      );

      const top = rows[0];
      const returnedSpaces = [...new Set(rows.map((r) => r.space_id))];
      const passed = Boolean(top)
        && top.space_id === space
        && returnedSpaces.length === 1
        && top.document_id === testCase.expectedDocumentId
        && top.chunk_index === testCase.expectedChunkIndex;

      summary.cases.push({
        query: testCase.query,
        expected: { documentId: testCase.expectedDocumentId, chunkIndex: testCase.expectedChunkIndex },
        top: top ? { documentId: top.document_id, chunkIndex: top.chunk_index, similarity: Number(top.similarity.toFixed(4)), head: top.content.slice(0, 50).replace(/\s+/g, ' ') } : null,
        returnedSpaces,
        passed
      });
    }

    summary.accuracy = summary.cases.filter((c) => c.passed).length / summary.cases.length;
    summary.allSingleSpace = summary.cases.every((c) => c.returnedSpaces.length === 1);
    summary.passed = summary.accuracy === 1 && summary.allSingleSpace;

    console.log(JSON.stringify(summary, null, 2));
    console.log(summary.passed ? 'RETRIEVAL EVAL: PASS' : 'RETRIEVAL EVAL: FAIL');

    if (!summary.passed) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`embedding-retrieval-eval: ${error.message}`);
  process.exitCode = 1;
});
