import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const EMBEDDING_MANIFEST_VERSION = 1;

export const EMBEDDING_SPACE_ID = 'bge-small-en-v1.5-mean-l2-int8-v1';

export const EMBEDDING_MANIFEST = Object.freeze({
  manifestVersion: EMBEDDING_MANIFEST_VERSION,
  spaceId: EMBEDDING_SPACE_ID,
  model: Object.freeze({
    repository: 'Xenova/bge-small-en-v1.5',
    revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3'
  }),
  pooling: 'mean',
  normalize: true,
  normalization: 'l2',
  dimensions: 384,
  quantization: 'int8',
  tokenizer: Object.freeze({
    tokenizerClass: 'BertTokenizer',
    maxLength: 512,
    padding: true,
    truncation: true,
    doLowerCase: true,
    cleanUpTokenizationSpaces: true
  }),
  preprocessing: Object.freeze({
    instructionPrefix: ''
  }),
  artifacts: Object.freeze([
    Object.freeze({ path: 'config.json', bytes: 683, sha256: 'fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350' }),
    Object.freeze({ path: 'tokenizer.json', bytes: 711396, sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66' }),
    Object.freeze({ path: 'tokenizer_config.json', bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' }),
    Object.freeze({ path: 'special_tokens_map.json', bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' }),
    Object.freeze({ path: 'quantize_config.json', bytes: 674, sha256: '0e60fbafb996a0ff2656cf0e41c13fdf81c8f21faf564840c3b9d478c6e78479' }),
    Object.freeze({ path: 'onnx/model_quantized.onnx', bytes: 34014426, sha256: '6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4' })
  ])
});

export function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const MODEL_DIR_SEGMENTS = Object.freeze(['Xenova', 'bge-small-en-v1.5']);

export function resolveModelDir(cacheDir, revision = EMBEDDING_MANIFEST.model.revision) {
  if (!cacheDir) {
    return null;
  }

  return path.join(cacheDir, ...MODEL_DIR_SEGMENTS, revision);
}

export function resolveArtifactPath(cacheDir, artifactPath, revision = EMBEDDING_MANIFEST.model.revision) {
  const modelDir = resolveModelDir(cacheDir, revision);
  return modelDir ? path.join(modelDir, artifactPath) : null;
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function verifyArtifacts({ cacheDir, manifest = EMBEDDING_MANIFEST }) {
  const checked = [];
  const failures = [];

  for (const artifact of manifest.artifacts) {
    const filePath = resolveArtifactPath(cacheDir, artifact.path, manifest.model.revision);

    if (!filePath || !existsSync(filePath)) {
      checked.push({ path: artifact.path, ok: false, reason: 'missing' });
      failures.push({ path: artifact.path, reason: 'missing', expected: artifact.sha256 });
      continue;
    }

    const { size } = statSync(filePath);
    const actual = await sha256File(filePath);
    const ok = actual === artifact.sha256 && size === artifact.bytes;
    const reason = ok ? undefined : actual === artifact.sha256 ? 'size-mismatch' : 'checksum-mismatch';

    checked.push({ path: artifact.path, ok, reason, expected: artifact.sha256, actual, bytes: size, expectedBytes: artifact.bytes });

    if (!ok) {
      failures.push({
        path: artifact.path,
        reason,
        expected: artifact.sha256,
        actual,
        expectedBytes: artifact.bytes,
        bytes: size
      });
    }
  }

  return { ok: failures.length === 0, modelDir: resolveModelDir(cacheDir, manifest.model.revision), checked, failures };
}

export function runtimeConfigFromEnv(env = process.env) {
  return {
    model: env.LOCAL_EMBEDDING_MODEL || env.EMBEDDING_LOCAL_MODEL || EMBEDDING_MANIFEST.model.repository,
    revision: env.EMBEDDING_LOCAL_REVISION || undefined,
    pooling: env.EMBEDDING_LOCAL_POOLING || EMBEDDING_MANIFEST.pooling,
    quantized: parseBoolean(env.EMBEDDING_LOCAL_QUANTIZED, EMBEDDING_MANIFEST.quantization === 'int8'),
    normalize: parseBoolean(env.EMBEDDING_LOCAL_NORMALIZE, EMBEDDING_MANIFEST.normalize),
    dimensions: Number(env.EMBEDDING_LOCAL_DIMENSIONS) || EMBEDDING_MANIFEST.dimensions,
    cacheDir: env.EMBEDDING_CACHE_DIR || undefined,
    allowRemoteModels: parseBoolean(env.EMBEDDING_LOCAL_ALLOW_REMOTE, true)
  };
}

export function diffRuntimeConfigAgainstManifest(config, manifest = EMBEDDING_MANIFEST) {
  const mismatches = [];

  if (config.model !== manifest.model.repository) {
    mismatches.push({ field: 'model', runtime: config.model, manifest: manifest.model.repository });
  }

  if (config.revision && config.revision !== manifest.model.revision) {
    mismatches.push({ field: 'revision', runtime: config.revision, manifest: manifest.model.revision });
  }

  if (config.pooling !== manifest.pooling) {
    mismatches.push({ field: 'pooling', runtime: config.pooling, manifest: manifest.pooling });
  }

  if (config.normalize !== manifest.normalize) {
    mismatches.push({ field: 'normalize', runtime: config.normalize, manifest: manifest.normalize });
  }

  if (config.dimensions !== manifest.dimensions) {
    mismatches.push({ field: 'dimensions', runtime: config.dimensions, manifest: manifest.dimensions });
  }

  const expectedQuantized = manifest.quantization === 'int8';
  if (config.quantized !== expectedQuantized) {
    mismatches.push({ field: 'quantized', runtime: config.quantized, manifest: expectedQuantized });
  }

  return mismatches;
}

export function assertRuntimeConfigMatchesManifest(env = process.env) {
  const config = runtimeConfigFromEnv(env);
  const mismatches = diffRuntimeConfigAgainstManifest(config);

  if (mismatches.length > 0) {
    const details = mismatches.map((m) => `${m.field}: runtime=${JSON.stringify(m.runtime)} manifest=${JSON.stringify(m.manifest)}`).join('; ');
    throw new Error(`Local embedding runtime configuration disagrees with embedding manifest (${EMBEDDING_SPACE_ID}): ${details}`);
  }

  return config;
}
