import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  EMBEDDING_MANIFEST,
  EMBEDDING_SPACE_ID,
  assertRuntimeConfigMatchesManifest,
  resolveArtifactPath,
  sha256Buffer,
  verifyArtifacts
} from '../../server/embeddings/embeddingManifest.js';

function parseArgs(argv) {
  const args = { download: false, checkEnv: false, json: false, cacheDir: null };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    switch (token) {
      case '--cache-dir':
        args.cacheDir = argv[i + 1];
        i += 1;
        break;
      case '--download':
        args.download = true;
        break;
      case '--check-env':
        args.checkEnv = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.cacheDir) {
    throw new Error('--cache-dir is required');
  }

  return args;
}

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArtifact({ artifact, revision }) {
  const url = `https://huggingface.co/${EMBEDDING_MANIFEST.model.repository}/resolve/${revision}/${artifact.path}`;
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });

  if (!response.ok) {
    const error = new Error(
      `Failed to download ${artifact.path} (HTTP ${response.status}) from pinned revision.`
    );
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length !== artifact.bytes) {
    const error = new Error(
      `Size mismatch for ${artifact.path}: expected ${artifact.bytes} bytes, got ${buffer.length}. Refusing to write.`
    );
    error.retryable = false;
    throw error;
  }

  const actual = sha256Buffer(buffer);

  if (actual !== artifact.sha256) {
    const error = new Error(
      `Checksum mismatch for ${artifact.path}: expected ${artifact.sha256}, got ${actual}. Refusing to write.`
    );
    error.retryable = false;
    throw error;
  }

  return buffer;
}

async function publishArtifactAtomically(target, buffer) {
  const directory = path.dirname(target);
  const tempPath = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, buffer);
    await rename(tempPath, target);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function downloadArtifact({ cacheDir, artifact, revision }) {
  const target = resolveArtifactPath(cacheDir, artifact.path, revision);
  let lastError = null;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const buffer = await fetchArtifact({ artifact, revision });
      await publishArtifactAtomically(target, buffer);
      return { path: artifact.path, bytes: buffer.length, attempts: attempt };
    } catch (error) {
      lastError = error;

      if (error.retryable === false || attempt === DOWNLOAD_ATTEMPTS) {
        break;
      }

      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Unable to fetch ${artifact.path} after ${DOWNLOAD_ATTEMPTS} attempts: ${reason}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const revision = EMBEDDING_MANIFEST.model.revision;
  const result = { spaceId: EMBEDDING_SPACE_ID, revision, cacheDir: args.cacheDir, downloaded: [], verified: null, envMatch: null };

  if (args.download) {
    const preexisting = await verifyArtifacts({ cacheDir: args.cacheDir });

    for (const artifact of EMBEDDING_MANIFEST.artifacts) {
      const alreadyOk = preexisting.checked.find((c) => c.path === artifact.path)?.ok;

      if (alreadyOk) {
        continue;
      }

      result.downloaded.push(await downloadArtifact({ cacheDir: args.cacheDir, artifact, revision }));
    }
  }

  const verification = await verifyArtifacts({ cacheDir: args.cacheDir });
  result.verified = { ok: verification.ok, modelDir: verification.modelDir, failures: verification.failures };

  if (args.checkEnv) {
    try {
      const config = assertRuntimeConfigMatchesManifest();
      result.envMatch = { ok: true, revisionRequested: config.revision ?? null, allowRemoteModels: config.allowRemoteModels };
    } catch (error) {
      result.envMatch = { ok: false, error: error.message };
    }
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Embedding space: ${result.spaceId} (revision ${revision})`);
    console.log(`Cache dir: ${args.cacheDir}`);
    if (result.downloaded.length) {
      for (const d of result.downloaded) {
        console.log(`  downloaded ${d.path} (${d.bytes} bytes)`);
      }
    }
    for (const c of verification.checked) {
      console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${c.path}${c.ok ? '' : ` (${c.reason}${c.reason === 'checksum-mismatch' ? `: expected ${c.expected}, got ${c.actual}` : ''})`}`);
    }
    if (result.envMatch) {
      console.log(`  env-vs-manifest: ${result.envMatch.ok ? 'MATCH' : `MISMATCH (${result.envMatch.error})`}`);
    }
    console.log(`Artifact verification: ${verification.ok ? 'PASS' : 'FAIL'}`);
  }

  const failed = !verification.ok || (args.checkEnv && result.envMatch && result.envMatch.ok === false);

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`embedding-artifacts: ${error.message}`);
  process.exitCode = 1;
});
