import { readFile, writeFile } from 'node:fs/promises';

import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';

/**
 * Pre-computes query vectors for the evaluation cases into a cache file that the
 * retrieval evaluator consumes via `--query-cache`. Batching all queries into a
 * single Voyage request keeps the request count minimal under the free tier.
 *
 * This script makes real (billable) Voyage calls. It is only run on explicit
 * approval. It never falls back to another provider.
 *
 * Usage:
 *   node --env-file=.env scripts/dev/voyage-query-cache.mjs \
 *     --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json \
 *     --out <cache.json> [--model voyage-4-lite] [--dimensions 1024]
 */

function parseArgs(argv) {
  const args = { cases: null, out: null, model: null, dimensions: null };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];
    switch (token) {
      case '--cases': args.cases = next(); break;
      case '--out': args.out = next(); break;
      case '--model': args.model = next(); break;
      case '--dimensions': args.dimensions = Number(next()); break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.cases) throw new Error('Missing required --cases <resolved.json>.');
  if (!args.out) throw new Error('Missing required --out <cache.json>.');

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  if (!env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not set. Run with --env-file=.env after approval.');
  }

  const cases = JSON.parse(await readFile(args.cases, 'utf8'));
  const queries = cases.filter((c) => typeof c.query === 'string').map((c) => ({ id: c.id, query: c.query }));

  const provider = new VoyageProvider({
    apiKey: env.VOYAGE_API_KEY,
    model: args.model || env.VOYAGE_MODEL || 'voyage-4-lite',
    baseUrl: env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1',
    dimensions: args.dimensions || (env.VOYAGE_OUTPUT_DIMENSION ? Number(env.VOYAGE_OUTPUT_DIMENSION) : 1024),
    inputType: 'query',
    normalize: true
  });

  const startedAt = Date.now();
  const vectors = await provider.embedMany(queries.map((q) => q.query));

  if (vectors.length !== queries.length) {
    throw new Error(`Expected ${queries.length} query vectors, received ${vectors.length}.`);
  }

  const cache = {};
  for (let i = 0; i < queries.length; i += 1) {
    cache[queries[i].id] = vectors[i];
  }

  await writeFile(args.out, `${JSON.stringify(cache)}\n`, 'utf8');

  console.log(JSON.stringify({
    mode: 'query-cache',
    provider: 'voyage',
    model: provider.model,
    dimensions: provider.dimensions,
    queries: queries.length,
    requests: 1,
    usage: provider.getUsageSnapshot(),
    elapsedMs: Date.now() - startedAt,
    out: args.out
  }, null, 2));
  console.log('VOYAGE QUERY CACHE: OK');
}

main().catch((error) => {
  console.error(`voyage-query-cache: ${error.message}`);
  process.exitCode = 1;
});
