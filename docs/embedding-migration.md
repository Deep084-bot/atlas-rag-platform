# Embedding space migration (Stage 2.3)

This document describes the pinned INT8 local embedding space, the manifest that
defines it, and a **proposed** production schema change. The schema change is
**documented only and has not been applied**. Production vectors, the database
schema, and the default `huggingface` provider are unchanged.

## Embedding manifest

The single source of truth is `server/embeddings/embeddingManifest.js`. The
runtime configuration, the Docker image, and the migration tooling all read from
it, and mismatches fail loudly instead of silently diverging.

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
`EMBEDDING_LOCAL_STRICT=true` makes `createEmbeddingProvider` throw at startup if
any local embedding env var disagrees with the manifest.

## Why a new space

The hosted `BAAI/bge-small-en-v1.5` path and the local `Xenova` ONNX conversion
are different weight graphs, and the stored vectors' pooling is unverified. The
safe assumption is that existing `chunks.embedding` values belong to an
**older space** and must not be mixed with new local vectors in one query.

## Proposed production schema change (NOT APPLIED)

An additive, non-destructive migration to record embedding-space provenance and
let retrieval filter to a single space:

```sql
CREATE TABLE IF NOT EXISTS embedding_spaces (
  id text PRIMARY KEY,
  model_repository text NOT NULL,
  model_revision text NOT NULL,
  pooling text NOT NULL,
  normalization text NOT NULL,
  dimensions integer NOT NULL,
  quantization text NOT NULL,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding_space_id text REFERENCES embedding_spaces(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_space_id text REFERENCES embedding_spaces(id);

CREATE INDEX IF NOT EXISTS chunks_embedding_space_idx ON chunks (embedding_space_id);

-- Per-space vector index. A partial HNSW index per space keeps spaces isolated.
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_space_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding_space_id IS NOT NULL;
```

Backfill would tag all existing rows with a legacy space id (e.g.
`legacy-huggingface-<unknown-pooling>`), and retrieval would always filter by a
single `embedding_space_id`. Re-indexing HNSW is a maintenance operation and
should be scheduled. **This migration is not applied in this stage.**

The staging tooling avoids this schema change entirely by writing new vectors to
a separate shadow table (`embedding_shadow_chunks`), leaving production tables
and old vectors untouched.

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

## Rollback

New vectors live only in `embedding_shadow_chunks`; production `chunks.embedding`
is never written. Rollback is `DROP TABLE embedding_shadow_chunks,
embedding_migration_progress;`. Old vectors remain intact.
