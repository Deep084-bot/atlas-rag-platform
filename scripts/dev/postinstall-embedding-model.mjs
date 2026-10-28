import { spawnSync } from 'node:child_process';

import { parseBoolean, resolveBundledCacheDir } from '../../server/embeddings/embeddingManifest.js';

const provider = (process.env.EMBEDDING_PROVIDER || '').trim().toLowerCase();
const force = parseBoolean(process.env.ATLAS_BUNDLE_EMBEDDING_MODEL, false);
const isLocal = provider === 'local' || provider === 'local-transformers';

if (!isLocal && !force) {
  process.exit(0);
}

const cacheDir = resolveBundledCacheDir();

const result = spawnSync(
  process.execPath,
  ['scripts/dev/embedding-artifacts.mjs', '--cache-dir', cacheDir, '--download'],
  { stdio: 'inherit', env: process.env }
);

if (result.error) {
  console.error(`postinstall-embedding-model: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`postinstall-embedding-model: terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
