# Embedding space migration (Stage 2.3)

This document describes the distinct hosted/local BGE embedding spaces, the
manifest that defines the local INT8 space, and the additive provenance
migration. The migration file and application code exist in this branch; it has
**not** been applied to production. Production vectors, the production database
schema, and the default `huggingface` provider are unchanged.

See [`docs/local-embedding-cutover.md`](./local-embedding-cutover.md) for the
hosted-BGE-to-local-BGE cutover and rollback procedure.

## Embedding manifest

The single source of truth is `server/embeddings/embeddingManifest.js`. The
runtime configuration, the Docker image, and the migration tooling all read from
it, and mismatches fail loudly instead of silently diverging.

There are two separate 384-dimensional BGE spaces:

| Space | ID | Provider | Model |
| --- | --- | --- | --- |
| Hosted BGE | `bge-small-en-v1.5-hosted-l2-v1` | `huggingface` | `BAAI/bge-small-en-v1.5` |
| Local BGE INT8 | `bge-small-en-v1.5-mean-l2-int8-v1` | `local` | `Xenova/bge-small-en-v1.5` |

The local space is defined by the manifest:

| Field | Value |
| --- | --- |
| Space id | `bge-small-en-v1.5-mean-l2-int8-v1` |
| Repository | `Xenova/bge-small-en-v1.5` |
| Revision | `ea104dacec62c0de699686887e3f920caeb4f3e3` |
| Pooling | `mean` |
| Normalization | `l2` (vectors stored L2-normalized) |
| Dimensions | `384` |
| Quantization | `int8` (`onnx/model_quantized.onnx`) |
| Tokenizer | `BertTokenizer`, max length `512`, padding `true`, truncation `true`, `do_lower_case` |
| Instruction prefix | none (BGE v1.5 needs no query prefix) |

Artifacts (SHA-256, pinned revision):

| Path | Bytes | SHA-256 |
| --- | --- | --- |
| `config.json` | 683 | `fa73f90bf92c8cace1fbcb709626306f2bdbc9ea3e5b5f94b440df9b6aa56350` |
| `tokenizer.json` | 711396 | `d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66` |
| `tokenizer_config.json` | 366 | `9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3` |
| `special_tokens_map.json` | 125 | `b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3` |
| `quantize_config.json` | 674 | `0e60fbafb996a0ff2656cf0e41c13fdf81c8f21faf564840c3b9d478c6e78479` |
| `onnx/model_quantized.onnx` | 34014426 | `6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4` |

The Docker image bakes these artifacts into `/app/model-cache` under
`<cacheDir>/Xenova/bge-small-en-v1.5/<revision>/` and sets
`EMBEDDING_LOCAL_ALLOW_REMOTE=false`, so runtime startup needs no network access.
`EMBEDDING_LOCAL_STRICT=true` makes `createEmbeddingProvider` reject manifest
config disagreements and makes the provider verify every bundled artifact's size
and SHA-256 before model initialization.

## Why separate spaces

The hosted `BAAI/bge-small-en-v1.5` path and the local `Xenova` ONNX conversion
are different weight graphs. Even at the same 384 dimensions, equivalence has not
been demonstrated, so vectors from one path must not be compared with the other.
Existing `chunks.embedding` rows were written before provenance existed and are
therefore **legacy/unknown**, not implicitly hosted or local.

Hosted and local write paths now tag new rows with their respective space IDs.
Retrieval is scoped to one space and fails closed if incompatible rows exist:

- the default policy blocks `NULL` legacy rows for every space;
- `EMBEDDING_LEGACY_UNKNOWN_POLICY=include` is a temporary hosted-only
  compatibility mode for existing hosted rows without provenance;
- local/Voyage search always rejects `NULL` and foreign-space rows;
- the compatibility check is global, so one incompatible row blocks all users.

## Additive schema migration (NOT APPLIED TO PRODUCTION)

The migrations are split for safe production rollout:

- `database/migrations/20261027_add_chunk_embedding_space.sql` — column only
  (additive, transaction-safe). Adds `chunks.embedding_space_id` (text, NULL)
  and its comment.
- `database/migrations/20261028_add_chunk_embedding_space_index_concurrently.sql`
  — index only, **must run outside a transaction** via `CREATE INDEX
  CONCURRENTLY`. On large tables this avoids long locks; a failed concurrent
  build leaves an INVALID index that must be dropped before retrying.

```sql
-- 20261027 (column)
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_space_id text;

COMMENT ON COLUMN chunks.embedding_space_id IS
  'Embedding space that produced chunks.embedding. NULL means legacy/unknown provenance and must not be treated as a hosted or local vector without evidence.';

-- 20261028 (index, outside transaction)
CREATE INDEX CONCURRENTLY IF NOT EXISTS chunks_embedding_space_idx
  ON chunks (embedding_space_id);
```

`database/schema.sql` is a bootstrap file for a new/empty database. It uses
`CREATE TABLE IF NOT EXISTS`, so applying it to an existing database does **not**
add this column and may fail when it tries to create the index. The migrations
above must run before the provenance-aware application is deployed. On a large
table **do not** create the index inside a transaction; use the concurrent
migration outside a transaction. For disposable/test databases either approach is
fine.

`NULL` means legacy/unknown provenance. Do not infer a provider from vector
dimensions or values. The default `block` policy excludes those rows from search
and from "fully embedded" counts. A hosted deployment may opt into
`EMBEDDING_LEGACY_UNKNOWN_POLICY=include` only as a temporary compatibility step;
the setting is rejected for local/Voyage and should be removed after backfill.
The migration is additive and does not rewrite vectors, drop indexes, or change
the `vector(384)` type.

Retrieval applies `chunks.embedding_space_id` filters and a global compatibility
check. The check returns a sanitized `EmbeddingSpaceError` (HTTP 503) listing only
space IDs and counts, never document text or vectors. It is global, not
user-scoped, and runs on every search; a scoped/indexed design is required before
relying on it at production scale.

The staging tooling still avoids the production schema change by writing new
vectors to a separate shadow table (`embedding_shadow_chunks`), leaving production
tables and old vectors untouched.

## Staging runbook (exact commands)

Prerequisites: a staging/disposable Postgres with `pgvector`, the schema loaded,
and a local pinned model cache (`EMBEDDING_CACHE_DIR`). Never point these at
production.

```sh
export EMBEDDING_CACHE_DIR=/path/to/atlas-pinned-cache
export EMBEDDING_LOCAL_REVISION=ea104dacec62c0de699686887e3f920caeb4f3e3
export EMBEDDING_LOCAL_QUANTIZED=true
export EMBEDDING_LOCAL_POOLING=mean
export EMBEDDING_LOCAL_ALLOW_REMOTE=false
export MIGRATION_DATABASE_URL=postgresql://user@host:5432/atlas_staging

# 0. (optional) bake/verify artifacts
node scripts/dev/embedding-artifacts.mjs --cache-dir "$EMBEDDING_CACHE_DIR" --download --check-env

# 1. dry run (no writes, no tables created)
node scripts/dev/embedding-migration.mjs --dry-run \
  --database-url "$MIGRATION_DATABASE_URL" --space bge-small-en-v1.5-mean-l2-int8-v1

# 2. apply to staging
node scripts/dev/embedding-migration.mjs --apply --confirm-disposable \
  --database-url "$MIGRATION_DATABASE_URL" --space bge-small-en-v1.5-mean-l2-int8-v1

# 3. retrieval quality over a representative query set
node scripts/dev/embedding-retrieval-eval.mjs \
  --database-url "$MIGRATION_DATABASE_URL" --space bge-small-en-v1.5-mean-l2-int8-v1 \
  --cases path/to/cases.json
```

The tooling refuses to run unless: a target URL is provided explicitly (it never
falls back to `DATABASE_URL`), the target is not identical to `DATABASE_URL`, the
database name looks staging/disposable, `--confirm-disposable` is set for
`--apply`, and `--space` matches the manifest.

## Staging rollback

New staging vectors live only in `embedding_shadow_chunks`; production
`chunks.embedding` is never written. Rollback is `DROP TABLE embedding_shadow_chunks,
embedding_migration_progress;`. Old vectors remain intact. For the production
hosted-to-local rollback, see `docs/local-embedding-cutover.md`.

## Production re-embedding

The checked-in migration tooling writes only to the shadow table
`embedding_shadow_chunks` and refuses production-like targets. The per-document
`POST /documents/:id/embed` route is not an operator bulk workflow. Before any
production re-embed, use the design and safety gates in
[`docs/production-reembedding-design.md`](./production-reembedding-design.md).
Do not add an unrestricted bulk writer or run a staging script against
production.

## Voyage embeddings (opt-in, separate space)

`EMBEDDING_PROVIDER=voyage` selects `server/embeddings/VoyageProvider.js`. It is
**not** the default and must not be enabled in production until the migration
below is completed. Voyage vectors are a different space from BGE and must never
be mixed with existing `chunks.embedding` values.

Key constraints:

- **Dimensions.** `voyage-4-lite` defaults to 1024 and supports
  `2048`/`1024`/`512`/`256`. It does **not** support `384`, so the configured
  `VOYAGE_OUTPUT_DIMENSION` cannot match the current `chunks.embedding vector(384)`.
- **Space.** Voyage embeddings cannot be compared against BGE embeddings;
  retrieval must run entirely within one space. Matching dimensions would **not**
  make two spaces compatible — vectors from `BAAI/bge-small-en-v1.5` and any
  Voyage model are semantically unrelated, so cosine similarity across them is
  meaningless. Compatibility requires using the same model/space on both sides.
- **Model choice.** Atlas is general-purpose, so the general `voyage-4` series
  (`voyage-4-lite`/`voyage-4`/`voyage-4-large`) is appropriate. The domain models
  (`voyage-code-4`, `voyage-law-2`, `voyage-finance-2`) are specialized and are
  not recommended for general document RAG.
- The `chunks.embedding_space_id` provenance column applies equally to a Voyage
  space (it is not BGE-specific). A Voyage migration would use a target column or
  table of the chosen dimension, tag its rows, and re-embed every chunk with
  Voyage.
- Use the shadow-table staging path (`embedding_shadow_chunks`) with a matching
  dimension before touching production.

Switching providers is a controlled re-embed migration, not a config toggle.

## Production cutover plan: BGE 384 -> Voyage 1024

> **STATUS: PROPOSED - NOT APPLIED. DO NOT EXECUTE.**
> This section is a plan only. No production schema change, vector rewrite, or
> environment change has been made. Production still runs the `huggingface`
> (BGE) provider with `chunks.embedding vector(384)`. Nothing here is approved
> for production execution; every step requires explicit sign-off.

### Current vs target space

| | Current (production) | Target (proposed) |
| --- | --- | --- |
| Provider | `huggingface` / local `Xenova` BGE | `voyage` |
| Model | `BAAI/bge-small-en-v1.5` | `voyage-4-lite` |
| Dimensions | `384` | `1024` (default) |
| Column | `chunks.embedding vector(384)` | `chunks.embedding vector(1024)` (or a new space column/table) |

The two spaces are semantically unrelated. Identical dimensions would **not**
make them comparable: cosine similarity across a BGE vector and a Voyage vector
is meaningless. Every chunk must be re-embedded with the same space used for
queries.

### Why `EMBEDDING_PROVIDER=voyage` alone breaks production

The runtime write and read paths both target `chunks.embedding vector(384)`:

- Ingestion (`EmbeddingRepository`) writes the provider's vector into
  `chunks.embedding`. A 1024-dim Voyage vector into a `vector(384)` column fails
  at insert time.
- Retrieval (`SearchRepository`) compares the query vector against
  `chunks.embedding`. A 1024-dim query against stored 384-dim vectors fails the
  pgvector dimension check.

So flipping the provider is **not** a config toggle: without a schema change and
a full re-embed, ingestion errors and search breaks. No Voyage model supports
`384`, so matching the existing column is impossible.

### Environment variables (for a staging rehearsal only)

Set these on a staging/disposable target, never production, and only after
sign-off:

| Variable | Value |
| --- | --- |
| `EMBEDDING_PROVIDER` | `voyage` (production stays `huggingface` until cutover is approved) |
| `VOYAGE_API_KEY` | required when provider is `voyage`; never log or commit |
| `VOYAGE_MODEL` | `voyage-4-lite` |
| `VOYAGE_BASE_URL` | `https://api.voyageai.com/v1` |
| `VOYAGE_OUTPUT_DIMENSION` | blank -> `1024`; `384` is not supported |
| `VOYAGE_INPUT_TYPE` | blank -> provider sends `query`/`document` per call site |
| `VOYAGE_NORMALIZE` | `true` |
| `MIGRATION_DATABASE_URL` | staging only; the migration tool never falls back to `DATABASE_URL` |

Do not use domain models (`voyage-code-4`, `voyage-law-2`, `voyage-finance-2`).

### Rate limits, retries, and usage accounting

- Voyage free tier is **3 requests/minute / 10K tokens/minute** with no payment
  method; `429` responses are expected at any real volume. Standard limits
  require adding a payment method (not done).
- `fetchWithRetry` now honors `Retry-After` on `429` (integer seconds or
  HTTP-date), falls back to a rate-limit floor when the header is missing or
  invalid, applies bounded exponential backoff to transient `5xx`, caps the
  delay, and clamps the retry count. It never includes the raw response body (or
  credentials) in the thrown error.
- Even with `Retry-After`, migration runs should still pass `--delay-ms`
  (e.g. `>= 21000`) to stay under 3 RPM.
- `VoyageProvider.getUsageSnapshot()` reports aggregate `totalTokens` for
  successful, fully-validated responses (unavailable rather than invented when
  the API omits it). The migration records per-document `token_count` /
  `tokens_available` in `embedding_migration_progress` so usage accumulates
  across resumptions without counting failed or repeated attempts as successful
  work. Neither logs document text, queries, or keys.

### Pre-flight checklist (all required before any production action)

1. Confirm Voyage billing/quota and raise limits (payment method) - **currently
  unverified blocker**.
- [ ] Take a full production backup (`pg_dump`) and record a vector-count baseline.
- [ ] Decide the 1024-dim storage approach (alter `chunks.embedding` to
  `vector(1024)`, or add a space-scoped column/table per the proposal above).
- [ ] Apply and validate the schema change on a staging clone first.
- [ ] Rehearse the full migration on a staging clone at realistic volume and
  measure token usage and 429 behavior.
- [ ] Run retrieval eval on a **representative real query set** (not the 16-chunk
  synthetic corpus) and compare Voyage against the BGE baseline (Recall@k and
  no-answer separability).
- [ ] Instrument/review usage totals so cost is measured, not estimated.
- [ ] Define the cutover window and write-freeze procedure.

### Cutover steps (after sign-off, staging-proven)

1. Take a full production backup and record the pre-cutover vector count.
2. Apply the approved schema change for the 1024-dim column/index.
3. Backfill all chunks into the new space (shadow table first, with
   `--delay-ms` throttling and resumable progress).
4. Validate: vector count, dimensions, finiteness, L2 norm ~= 1, and that a
   probe query returns only one space.
5. Switch the runtime read/write path to Voyage and deploy.
6. Smoke-test ingestion and retrieval; monitor `429`/error rates.

### Verification after cutover

- Every chunk has a 1024-dim, finite, L2-normalized vector in exactly one space.
- Retrieval returns results only from the Voyage space; citations resolve.
- No mixed-space comparisons occur anywhere in the read path.

### Rollback

- Pre-cutover (current staging state): drop `embedding_shadow_chunks` and
  `embedding_migration_progress`; production is untouched.
- Post-schema-change: revert the schema change (transactional DDL where
  possible), restore from the pre-cutover `pg_dump`, and set
  `EMBEDDING_PROVIDER` back to `huggingface`/`local`.
- **Keep the old BGE vectors until the Voyage space is fully verified.** Do not
  delete `chunks.embedding` data as part of the Voyage cutover.

### Open blockers and missing evidence

- Voyage billing/quota state is **unverified** (free trial only).
- No production-scale run; quota burn at production volume is unmeasured.
- Retrieval evidence is from a 16-chunk synthetic corpus (low statistical
  power); a representative query set is still required.
- The production 1024-dim schema/read-path change is designed but **not
  implemented**; until it exists, production cannot run Voyage.
- `--space bge-small-en-v1.5-mean-l2-int8-v1` examples in the runbook above
  predate the `--provider`/`--dimensions` flags; prefer
  `--provider voyage --dimensions 1024` for Voyage rehearsals.
