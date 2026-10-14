# Deployment

## Embedding providers

Embeddings are selected with `EMBEDDING_PROVIDER`.

| Value | Provider | API key required |
| --- | --- | --- |
| `huggingface` (default) | Hosted Hugging Face Inference API (`BAAI/bge-small-en-v1.5`) | `HF_API_KEY` |
| `local` / `local-transformers` | In-process ONNX model via `@xenova/transformers` | none |
| anything else | Startup error | — |

The default remains `huggingface`. The local provider exists to remove the
dependency on hosted Hugging Face Inference credits; it is not the production
default.

### Local provider configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `LOCAL_EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | ONNX export of `BAAI/bge-small-en-v1.5` |
| `EMBEDDING_LOCAL_REVISION` | (unset → `main`) | Pin an immutable HF commit (e.g. the manifest revision) |
| `EMBEDDING_LOCAL_POOLING` | `mean` | `mean` (manifest) or `cls` (official BGE) |
| `EMBEDDING_LOCAL_QUANTIZED` | `true` | `true` loads int8 weights (~34 MB) instead of fp32 (~133 MB) |
| `EMBEDDING_LOCAL_NORMALIZE` | `true` | L2 normalization |
| `EMBEDDING_LOCAL_DIMENSIONS` | `384` | Must match `chunks.embedding` |
| `EMBEDDING_LOCAL_ALLOW_REMOTE` | `true` | Set `false` to require pre-baked local artifacts (no download) |
| `EMBEDDING_LOCAL_STRICT` | `false` | Fail fast if env config disagrees with the embedding manifest |
| `EMBEDDING_CACHE_DIR` | `node_modules/@xenova/transformers/.cache` | Set to a persistent/baked path |

Defaults are drawn from the embedding manifest
(`server/embeddings/embeddingManifest.js`), which pins the model repository,
revision, pooling, normalization, dimension, quantization, tokenizer settings,
and artifact SHA-256 checksums. See
[`docs/embedding-migration.md`](./embedding-migration.md).

The model is loaded lazily on the first embedding request, memoized in-process
(single-flight, so concurrent requests share one load), and never falls back to
Hugging Face. Initialization and inference failures surface as `ProviderError`
(503 and 502 respectively) so operational failures are visible instead of being
masked.

## Vector compatibility (critical)

`chunks.embedding` is `vector(384)`. Dimension parity is necessary but not
sufficient — the retrieval space must also match.

- **Weights/revision.** `Xenova/bge-small-en-v1.5` is the Optimum ONNX conversion
  of `BAAI/bge-small-en-v1.5` (a conversion, not the same repo/revision). The
  fp32 graph (`model.onnx`) is numerically close to the original PyTorch model;
  the int8/quantized variants deviate slightly. The pinned space is int8
  (`EMBEDDING_LOCAL_QUANTIZED=true`) with mean pooling; the fp32/CLS baseline was
  validated earlier for reference and is not the selected space.
- **Tokenization/truncation.** Both paths use the same WordPiece vocab and
  512-token limit with right truncation.
- **Query instruction.** BGE documents an optional query prefix
  (`Represent this sentence for searching relevant passages: `) for short-query
  retrieval. Atlas does **not** add it anywhere today, so the local provider must
  also not add it; introducing it on only one side would break comparability.
- **Pooling.** Official BGE uses CLS pooling, but ecosystem examples vary (the
  `Xenova` model card shows `mean`; `onnx-community` shows `cls`). The existing
  hosted path mean-pools token matrices when the API returns token-level output,
  so the pooling used for **already-stored** vectors is unverified. The pinned
  space uses `mean` (matching the hosted path's mean-pooling behaviour); if stored
  vectors were CLS-pooled, mixing them degrades cosine comparability. Use
  `EMBEDDING_LOCAL_POOLING` to match, or re-embed.
- **Normalization.** Both paths L2-normalize. Retrieval uses cosine distance.

**Do not mix providers in one retrieval set.** Before switching an existing
database to local embeddings, either re-embed the documents with the local
provider or verify equivalence with a probe: embed the same sample texts through
both paths and compare cosine similarity (≈1.0 means compatible). Atlas does not
re-embed or modify stored vectors automatically.

## Hosting constraints

- **Alpine / musl.** `onnxruntime-node` (used by `@xenova/transformers`) is built
  against glibc and does not load on Alpine (`node:20-alpine`, the current
  Dockerfile base); the failure is `Error loading shared library
  ld-linux-x86-64.so.2`. There is no runtime WASM fallback in this library
  version. A glibc base image such as `node:20-slim` is required for the local
  path. Hugging Face deployments are unaffected because the library is imported
  lazily only when the local provider is selected.
- **Artifact size.** `onnxruntime-node` is ~90–220 MB unpacked; fp32 BGE-small is
  ~133 MB. This exceeds serverless function size limits (e.g. Vercel's 250 MB),
  so the local provider is not viable on Vercel.
- **Memory.** fp32 BGE-small plus ONNX Runtime plus the Express process is roughly
  300–500 MB RSS; the int8 model is lighter (~200–300 MB). A 512 MB instance is
  marginal, especially under concurrency.
- **Cache persistence.** The default cache lives inside `node_modules` and is
  wiped on rebuild. Without a persistent `EMBEDDING_CACHE_DIR`, every cold start
  re-downloads the model, slowing startup and risking request timeouts.
- **Health checks.** `/api/health` does not touch the model, and initialization is
  lazy, so model load does not fail startup health checks. The first embedding
  request after a cold start pays the download/init cost.

## Pinned local INT8 image

The backend Dockerfile builds on `node:20-bookworm-slim` (glibc, Node 20). It:

- prunes `onnxruntime-node` to the target platform only (`linux/<arch>`); the
  browser package `onnxruntime-web` is a static import in `@xenova/transformers`
  and cannot be removed;
- bakes the pinned INT8 model + tokenizer into `/app/model-cache` and verifies
  SHA-256 checksums at build time (`scripts/dev/embedding-artifacts.mjs`);
- sets `EMBEDDING_LOCAL_ALLOW_REMOTE=false` and `EMBEDDING_LOCAL_STRICT=true` so a
  missing/incorrect artifact fails loudly instead of downloading.

The default provider remains `huggingface`. Measured inside the image
(linux/arm64, `--memory=512m`): INT8 warm init ≈ 0.2–0.3 s, RSS after load
≈ 245 MB, container memory ≈ 190 MB; 16 parallel embed calls completed without
OOM; cold start with `--network none` succeeded (artifacts baked). Under a
Render-free-like `--cpus=0.1` limit, cold init was ≈ 14 s and a single 3-text
batch ≈ 4.4 s — functional but slow for interactive use.
