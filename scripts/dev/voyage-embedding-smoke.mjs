/**
 * Development-only smoke test for the opt-in Voyage embedding provider.
 *
 * GATED: this script does nothing unless VOYAGE_API_KEY is configured. It never
 * prints the API key. Does NOT touch any database. Run with:
 *   node scripts/dev/voyage-embedding-smoke.mjs
 *
 * NOTE: with a key configured this makes two small live requests (one batch of 3
 * short texts plus one usage probe), which deduct from the account's free token
 * allowance. It is not run automatically.
 *
 * Optional env:
 *   VOYAGE_MODEL              model id (default: voyage-4-lite)
 *   VOYAGE_BASE_URL           API base URL (default: https://api.voyageai.com/v1)
 *   VOYAGE_OUTPUT_DIMENSION   output dimension (default: model default)
 *   VOYAGE_INPUT_TYPE         "document" | "query" (default: omitted)
 *   VOYAGE_SMOKE_FORCE        "true" to error (instead of skip) when no key
 */

import 'dotenv/config';

import { VoyageProvider } from '../../server/embeddings/VoyageProvider.js';
import { fetchWithRetry } from '../../server/http/fetchWithRetry.js';

const TEXTS = [
  'What is the capital of France?',
  'PostgreSQL uses MVCC for concurrency control.',
  'Retrieval augmented generation combines search with an LLM.'
];

function cosine(a, b) {
  let dot = 0;
  let ma = 0;
  let mb = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }

  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? Number.NaN : dot / denom;
}

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

async function fetchUsage({ apiKey, baseUrl, model, texts }) {
  const response = await fetchWithRetry(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input: texts, model, input_type: 'document' })
  }, {
    providerName: 'Voyage'
  });

  if (!response.ok) {
    return { status: response.status };
  }

  const payload = await response.json();
  return { status: response.status, usage: payload?.usage ?? null };
}

async function main() {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    const message = 'VOYAGE_API_KEY is not set; skipping Voyage smoke test (gated).';
    if ((process.env.VOYAGE_SMOKE_FORCE || '').toLowerCase() === 'true') {
      console.error(message);
      process.exitCode = 1;
      return;
    }
    console.log(message);
    return;
  }

  const model = process.env.VOYAGE_MODEL || 'voyage-4-lite';
  const baseUrl = process.env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1';
  const dimensions = Number(process.env.VOYAGE_OUTPUT_DIMENSION) || null;
  const inputType = process.env.VOYAGE_INPUT_TYPE || null;

  const provider = new VoyageProvider({ apiKey, model, baseUrl, dimensions, inputType });

  const results = { model, baseUrl, configuredDimension: dimensions, inputType, embeddings: [], usage: null };

  const t0 = Date.now();
  const batch = await provider.embedMany(TEXTS);
  const batchMs = Date.now() - t0;

  batch.forEach((vector, index) => {
    results.embeddings.push({
      index,
      dims: vector.length,
      finite: vector.every(Number.isFinite),
      magnitude: +magnitude(vector).toFixed(6)
    });
  });

  results.batchMs = batchMs;
  results.cosineFirstVsSecond = +cosine(batch[0], batch[1]).toFixed(6);
  results.cosineFirstVsThird = +cosine(batch[0], batch[2]).toFixed(6);

  try {
    results.usage = await fetchUsage({ apiKey, baseUrl, model, texts: TEXTS });
  } catch (error) {
    results.usage = { error: error instanceof Error ? error.message : String(error) };
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error('VOYAGE SMOKE TEST FAILED:');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
