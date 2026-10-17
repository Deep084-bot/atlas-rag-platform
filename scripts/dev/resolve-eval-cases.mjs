import { readFile, writeFile } from 'node:fs/promises';

import { resolveCases } from './lib/resolve-cases.mjs';
import { estimateEvaluationUsage } from './lib/token-estimate.mjs';

/**
 * Offline resolver: turns a marker-labelled evaluation plan into concrete
 * (documentId, chunkIndex, grade) cases. Performs no database or network I/O.
 *
 * Usage:
 *   node scripts/dev/resolve-eval-cases.mjs --cases <plan.json> [--out <resolved.json>] [--json]
 */

function parseArgs(argv) {
  const args = { cases: null, out: null, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[(i += 1)];
    switch (token) {
      case '--cases': args.cases = next(); break;
      case '--out': args.out = next(); break;
      case '--json': args.json = true; break;
      default: throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.cases) {
    throw new Error('Missing required --cases <plan.json>.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(await readFile(args.cases, 'utf8'));

  if (!Array.isArray(plan.documents) || !Array.isArray(plan.cases)) {
    throw new Error('Plan fixture must contain "documents" and "cases" arrays.');
  }

  const resolved = resolveCases(plan);
  const usage = estimateEvaluationUsage({ cases: resolved, documents: [] });
  const answerable = resolved.filter((entry) => !entry.expectNoAnswer).length;
  const unanswerable = resolved.length - answerable;

  if (args.out) {
    await writeFile(args.out, `${JSON.stringify(resolved, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(resolved, null, 2));
  } else {
    console.log(`resolve-eval-cases: ${resolved.length} cases (${answerable} answerable, ${unanswerable} unanswerable)`);
    console.log(`estimated query tokens: ${usage.queryTokens} (~${usage.requestsIfOneQueryPerRequest} requests, one per query)`);
    if (args.out) {
      console.log(`wrote ${args.out}`);
    }
  }
}

main().catch((error) => {
  console.error(`resolve-eval-cases: ${error.message}`);
  process.exitCode = 1;
});
