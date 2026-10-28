# Deployment

## Embedding providers

Embeddings are selected with `EMBEDDING_PROVIDER`.

| Value | Provider | API key required |
| --- | --- | --- |
| `huggingface` (default) | Hosted Hugging Face Inference API (`BAAI/bge-small-en-v1.5`) | `HF_API_KEY` |
| `local` / `local-transformers` | In-process ONNX model via `@xenova/transformers` | none |
| `voyage` | Hosted Voyage AI embeddings (opt-in, not default) | `VOYAGE_API_KEY` |
| anything else | Startup error | — |

The default remains `huggingface`. The local provider exists to remove the
dependency on hosted Hugging Face Inference credits; it is not the production
default. The Voyage provider is opt-in and requires a migration before use (see
below).

### Legacy `NULL` provenance

| Variable | Default | Notes |
| --- | --- | --- |
| `EMBEDDING_LEGACY_UNKNOWN_POLICY` | `block` | `block` excludes `NULL` provenance from search and embedded counts. `include` is a temporary hosted-only compatibility mode and is rejected for local/Voyage. |

Existing vectors written before provenance existed have
`chunks.embedding_space_id IS NULL`. They are not assumed to be hosted or local.
Use `include` only after confirming the legacy rows are hosted and only until
they are backfilled with the hosted space ID; then return to `block`. The active
policy is included in the startup log, `/api/status`, and embedding-status
responses.

### Embedding error disclosure

Local initialization/inference errors and persisted document failure reasons are
sanitized before they leave the process. Filesystem paths, database URLs, bearer
tokens, and API-key/token/password assignments are redacted from API responses
and stored failure reasons. Server-side diagnostics retain the underlying error
detail (with credentials redacted) so operators can still troubleshoot model
cache problems.

### Local provider configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `LOCAL_EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | ONNX export of `BAAI/bge-small-en-v1.5` |
| `EMBEDDING_LOCAL_REVISION` | manifest revision (`ea104dac…`) | Pin an immutable HF commit; defaults to the manifest revision |
| `EMBEDDING_LOCAL_POOLING` | `mean` | `mean` (manifest) or `cls` (official BGE) |
| `EMBEDDING_LOCAL_QUANTIZED` | `true` | `true` loads int8 weights (~34 MB) instead of fp32 (~133 MB) |
| `EMBEDDING_LOCAL_NORMALIZE` | `true` | L2 normalization |
| `EMBEDDING_LOCAL_DIMENSIONS` | `384` | Must match `chunks.embedding` |
| `EMBEDDING_LOCAL_ALLOW_REMOTE` | `false` | Set `true` only for an explicit first-run/dev download |
| `EMBEDDING_LOCAL_STRICT` | `false` | Fail on manifest disagreement and verify cache size + SHA-256 before model initialization; production/Docker sets `true` |
| `EMBEDDING_CACHE_DIR` | unset | Preferred cache path; used only if it already contains the pinned artifacts |
| `EMBEDDING_BUNDLED_CACHE_DIR` | `<cwd>/model-cache` | Image/build-bundled pinned artifacts (also `ATLAS_MODEL_CACHE_DIR`) |

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

#### Bundled cache (no persistent disk)

In local mode the provider prefers `EMBEDDING_CACHE_DIR` only when that
directory already contains every pinned artifact at the exact manifest size.
Otherwise it falls back to the bundled cache (`<cwd>/model-cache` by default)
and forces `allowRemoteModels=false`. When strict mode is enabled, the provider
verifies every artifact's size and SHA-256 before model initialization, so a
selected truncated or same-size corrupted file fails clearly instead of loading.
An incomplete explicit path falls back only to a fully sized bundled cache; a
same-size explicit file is selected and then rejected by strict verification.
This makes a stale/unwritable path such as `/var/data` harmless without changing
production environment variables, and prevents runtime downloads or cache
writes.

Build the bundle reproducibly (pinned revision + SHA-256 verification):

```sh
npm run build:model   # downloads into ./model-cache, fails on checksum mismatch
```

The backend Dockerfile already does this at image build time into
`/app/model-cache` after dependency install. Its `npm ci` uses
`--ignore-scripts` so install-time hooks cannot race the artifact step. For a
Render *native Node* service (not Docker), the guarded `postinstall` hook uses
`EMBEDDING_BUNDLED_CACHE_DIR` (default `<cwd>/model-cache`) and runs the same
download automatically when `EMBEDDING_PROVIDER=local` (or
`ATLAS_BUNDLE_EMBEDDING_MODEL=1`); alternatively set the build command to
`npm ci && npm run build:model`. `model-cache/` is git-ignored; do not commit
weights.

### Voyage provider configuration (opt-in)

`EMBEDDING_PROVIDER=voyage` is **not** the default and must not be enabled in
production until the embedding-space migration is complete. Voyage vectors are a
different space from BGE and from the local ONNX space.

| Variable | Default | Notes |
| --- | --- | --- |
| `VOYAGE_API_KEY` | (unset) | Required; startup error if missing while `EMBEDDING_PROVIDER=voyage` |
| `VOYAGE_MODEL` | `voyage-4-lite` | General-purpose. Use `voyage-4`/`voyage-4-large` for more quality; do not use domain models |
| `VOYAGE_BASE_URL` | `https://api.voyageai.com/v1` | |
| `VOYAGE_OUTPUT_DIMENSION` | model default (`1024` for `voyage-4-lite`) | Must be `256`/`512`/`1024`/`2048`; **`384` is not supported** |
| `VOYAGE_INPUT_TYPE` | (derived) | Leave blank: `query` for `embed()`, `document` for `embedMany()`. Set only to force one value |
| `VOYAGE_NORMALIZE` | `true` | L2 normalization (also required after dimension truncation) |

Voyage returns L2-normalized vectors; the provider re-normalizes (a no-op for
default dimensions, required for Matryoshka-truncated dimensions). The provider
sets `input_type` per Voyage's retrieval guidance (queries vs documents get
different prompts; the two are mutually compatible by design). The constructor
rejects unsupported `VOYAGE_OUTPUT_DIMENSION` values and invalid `VOYAGE_INPUT_TYPE`
values with a clear `ProviderError` rather than silently proceeding.
Hosted-provider failures are stored as sanitized failure reasons (status-based,
without the raw provider response). The provider never logs the API key.

Per Voyage's own documentation, the general-purpose `voyage-4` series outperforms
the domain-specific models, so `voyage-4-lite`/`voyage-4`/`voyage-4-large` are the
right choice for Atlas — not `voyage-code-4`, `voyage-law-2`, or `voyage-finance-2`.

**Dimension mismatch:** the current `chunks.embedding` is `vector(384)`, which
Voyage cannot produce. Enabling Voyage requires a schema change or a
separate/shadow vector table of the chosen dimension plus a full re-embed. `voyage`
is available for evaluation and staging, not as a config-toggle swap.

Gated smoke test (does nothing without a key, never prints the key):

```sh
VOYAGE_API_KEY=... node scripts/dev/voyage-embedding-smoke.mjs
```

## Schema migration order and production re-embedding

For an existing database, apply every file in `database/migrations/` in filename
order **before** deploying code that reads or writes
`chunks.embedding_space_id`. `database/schema.sql` is bootstrap-only for a new
empty database; it cannot add columns to an existing table because it uses
`CREATE TABLE IF NOT EXISTS`.

The provenance migration is additive and split:
`20261027_add_chunk_embedding_space.sql` adds the column only (transaction-safe);
`20261028_add_chunk_embedding_space_index_concurrently.sql` builds
`chunks_embedding_space_idx` with `CREATE INDEX CONCURRENTLY` outside a
transaction. On a large production table, add the column first, build the
concurrent index outside a transaction, and only then deploy the application.
If a concurrent build fails it may leave an INVALID index that must be dropped
before retrying. No zero-downtime production run has been proven.

There is no approved bulk production re-embedding tool in this repository. The
per-document API is not an operator workflow, and the staging migration script
writes only to `embedding_shadow_chunks` and refuses production-like targets.
Use [`docs/production-reembedding-design.md`](./production-reembedding-design.md)
as the required design/checklist before implementing one.

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
re-embed or modify stored vectors automatically. See
[`docs/local-embedding-cutover.md`](./local-embedding-cutover.md) for the
provenance-guarded cutover and rollback procedure.

## Hosting constraints

- **Alpine / musl.** `onnxruntime-node` (used by `@xenova/transformers`) is built
  against glibc and does not load on Alpine. The backend image uses
  `node:20-bookworm-slim` (glibc, Node 20); the old `node:20-alpine` base was
  replaced because it failed with `Error loading shared library
  ld-linux-x86-64.so.2`. There is no runtime WASM fallback in this library
  version. Hugging Face deployments are unaffected because the library is
  imported lazily only when the local provider is selected.
- **Artifact size.** `onnxruntime-node` is ~90–220 MB unpacked; fp32 BGE-small is
  ~133 MB. This exceeds serverless function size limits (e.g. Vercel's 250 MB),
  so the local provider is not viable on Vercel.
- **Memory.** The int8 model plus ONNX Runtime plus the Express process measured
  ~272 MB RSS after load on macOS/arm64 (max ~285 MB); a 512 MB Render Free
  instance is viable only with headroom validation. Do not extrapolate an
  AMD64/Render memory result from arm64 documentation.
- **Cache persistence.** The Docker image bakes the cache at `/app/model-cache`;
  no persistent disk is required. A configured path that lacks the pinned files
  is ignored in favor of the bundle, and runtime downloads are disabled by
  default.
- **Health checks.** `/api/health` does not touch the model, and initialization is
  lazy, so model load does not fail startup health checks. The first embedding
  request after a cold start pays the init cost from the local bundle, not a
  network download.

## Pinned local INT8 image

The backend Dockerfile builds on `node:20-bookworm-slim` (glibc, Node 20). It:

- prunes `onnxruntime-node` to the target platform only (`linux/<arch>`); the
  browser package `onnxruntime-web` is a static import in `@xenova/transformers`
  and cannot be removed;
- bakes the pinned INT8 model + tokenizer into `/app/model-cache` and verifies
  SHA-256 checksums at build time (`scripts/dev/embedding-artifacts.mjs`);
- sets `EMBEDDING_LOCAL_ALLOW_REMOTE=false` and `EMBEDDING_LOCAL_STRICT=true` so a
  missing/incorrect artifact fails loudly instead of downloading.

The default provider remains `huggingface`. Earlier measurements inside
linux/arm64 (`--memory=512m`) showed INT8 warm init ≈ 0.2–0.3 s, RSS after load
≈ 245 MB, container memory ≈ 190 MB, 16 parallel embed calls without OOM, and a
cold start with `--network none` (artifacts baked). Under `--cpus=0.1`, cold
init was ≈ 14 s and a single 3-text batch ≈ 4.4 s. These are **arm64**
measurements and do not establish Render's AMD64 Free-tier behaviour; run the
AMD64 checks in `docs/local-embedding-cutover.md` before claiming readiness.
