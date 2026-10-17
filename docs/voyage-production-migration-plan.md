# Voyage production embedding migration — implementation plan

Status: **plan only. Nothing in this document has been implemented, applied, or
deployed.** Production (`DATABASE_URL` → Neon) is untouched. This plan exists so
the cutover can be reviewed before any code or migration runs.

Stage 0 design is complete: see
[`voyage-migration-stage-0-design.md`](./voyage-migration-stage-0-design.md). It
compares per-space vs shared storage, recommends the shared `vector(1024)` design
(**proposed**), and supersedes the target schema in §3 below.

## 1. Objective and invariants

Move the active embedding space from BGE (`bge-small-en-v1.5-mean-l2-int8-v1`,
384-d, local) to Voyage (`voyage-4-lite-query-document-l2-1024-v1`, 1024-d) for
production retrieval, with zero query downtime and a proven rollback.

Invariants:

1. **Never mix spaces in one column.** A BGE 384-d vector and a Voyage 1024-d
   vector are not comparable. A row's vector must always be labelled with the
   space that produced it.
2. **Query and document vectors must share one space.** The read path must use a
   query embedded with the same model/input type (`query`) as the documents
   (`document`).
3. Re-embedding is **idempotent and resumable**: safe to re-run after a crash or
   rate-limit stop without duplicating or corrupting vectors.
4. **No silent fallback.** If Voyage is unavailable the system degrades to the
   previous space or errors; it never embeds with a different model.

## 2. Current state (verified in this repo)

- Active vector store is a single column: `chunks.embedding vector(384)`
  (`database/migrations/20260530_add_embedding_column_to_chunks.sql`).
- Write path: `server/embeddings/embeddingService.js` →
  `EmbeddingRepository.updateChunkEmbedding()` →
  `UPDATE chunks SET embedding = $2::vector WHERE id = $1`
  (`server/embeddings/embeddingRepository.js:35`).
- Read path: `server/search/searchRepository.js` →
  `chunks.embedding <=> $1::vector` (`searchChunksByEmbedding` and
  `searchChunksByEmbeddingForUser`).
- Space/provider selection: `EMBEDDING_PROVIDER` env drives
  `resolveActiveEmbeddingSpace()` (`server/embeddings/embeddingSpaces.js`),
  which maps to BGE or the Voyage space. Dimensions are resolved by
  `resolveDimensionsForService()` and validated in `embeddingService` and
  `VoyageProvider`.
- Manifest/versioning: `server/embeddings/embeddingManifest.js` (BGE) and
  `EMBEDDING_SPACE_ID`; Voyage space is already defined in `embeddingSpaces.js`.
- Migration/shadow tooling exists for staging:
  `embedding_shadow_chunks` (space_id, document_id, source_chunk_id, embedding
  vector(1024), dimensions, l2_norm) and `embedding_migration_progress`
  (space_id, document_id, status, chunk_count, failure_reason, token_count,
  tokens_available).
- Migrations are forward-only files in `database/migrations/*.sql` (no runner in
  `package.json`; applied manually/out-of-band today — a runner or documented
  runbook is a prerequisite).

## 3. Target schema (versioned, dual-space during transition)

Recommended target: a **separate embeddings table** so multiple spaces can
coexist and be switched atomically at the application layer.

> **Correction (Stage 0).** An earlier draft of this section used an
> un-dimensioned `embedding vector` column. That is not indexable: pgvector
> requires fixed dimensions on the column, so HNSW/IVFFlat fail with
> `column does not have dimensions`. The column below is typed `vector(1024)`
> and indexed by a per-space **partial** index. Full rationale, the Design A/B
> comparison, and acceptance criteria are in
> [`voyage-migration-stage-0-design.md`](./voyage-migration-stage-0-design.md).

```sql
-- New table (does not touch chunks.embedding yet)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunk_embeddings (
  chunk_id    uuid NOT NULL REFERENCES chunks(id)    ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  space_id    text NOT NULL,
  embedding   vector(1024) NOT NULL,     -- fixed dimension: required for indexing
  l2_norm     double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, space_id)
);

CREATE INDEX chunk_embeddings_doc_idx ON chunk_embeddings (document_id, space_id);
-- Partial HNSW per space (the dimension is fixed on the column, the space
-- predicate isolates rows). Build after backfill:
CREATE INDEX chunk_embeddings_voyage_hnsw
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE space_id = 'voyage-4-lite-query-document-l2-1024-v1';
```

The un-dimensioned `embedding vector` form is invalid: pgvector cannot build
HNSW/IVFFlat on a column without declared dimensions (verified on PostgreSQL
18.3 / pgvector 0.8.6; see the Stage 0 design §2).

## 4. Versioned read/write path

- Introduce one active-space resolver used by both read and write:
  `activeSpace = resolveActiveEmbeddingSpace(env)` (already exists); add an
  explicit `EMBEDDING_SPACE_ID`/`EMBEDDING_SPACE_VERSION` config instead of
  inferring only from `EMBEDDING_PROVIDER`.
- **Write:** `embeddingService.embedDocument()` writes
  `(chunk_id, space_id, embedding)` into `chunk_embeddings`, using the active
  space's `documentInputType`. Keep the legacy `chunks.embedding` write behind a
  flag until cutover.
- **Read:** `SearchRepository` queries `chunk_embeddings` filtered by the active
  `space_id`, with a query vector produced by the same space. The `WHERE
  space_id = $active` clause is mandatory (prevents mixed-space comparisons).
- **Consistency check:** on startup, assert the configured space matches the
  space of the vectors the read path will use; refuse to serve if they disagree.

## 5. Full re-embedding runbook (production)

1. **Pre-req:** schema from §3 applied to production (additive only; no writes to
   existing columns). Take a verified backup / PITR checkpoint.
2. **Dry run:** size the job from `SELECT count(*) FROM chunks` and average chunk
   length; publish estimated tokens, requests, wall-clock, and cost. Voyage
   `voyage-4-lite` = $0.02 / 1M tokens; `embedding_migration_progress.token_count`
   gives measured usage.
3. **Backfill** into `chunk_embeddings` for `space_id = voyage-...`, batched
   (e.g. 128 inputs/request), honoring `Retry-After` and the account's RPM/TPM.
   Reuse the staging migration tool's shape: per-document progress rows,
   resumable, only pending documents processed, `status`, `token_count` recorded.
4. **Verify a sample** (§6) before proceeding.
5. **Cutover** (§7).
6. **Cleanup** (§8, after the rollback window).

Estimated cost is small for the current corpus but must be recomputed at
production scale; the trial tier (3 RPM / 10K TPM) is not viable for a large
corpus, so a paid/business tier and a documented rate budget are required.

## 6. Validation gates (must all pass before cutover)

- **Integrity:** for the target space, every chunk has exactly one row; `count(*)`
  equals `count(*) FROM chunks`; no NULL/invalid vectors; `dimensions = 1024`;
  `abs(l2_norm - 1) <= 0.01`.
- **Parity:** rows in `chunk_embeddings` map 1:1 to `chunks` for the space
  (mirrors the staging checks: 24/24 rows, 0 nulls, 0 bad dims, 0 bad norm).
- **Determinism/spot-check:** re-embed a fixed sample of chunks twice; identical
  vectors (same model/revision/input type).
- **Retrieval eval:** run the frozen case set (or the production equivalent)
  against the new space and reproduce the §9 comparison; require
  Recall@k / nDCG@k at least equal to the BGE baseline on the production corpus
  before promoting.
- **No-answer behaviour:** decide and test a rejection strategy (threshold,
  reranker, or LLM judge). Neither bi-encoder separates today, so shipping
  Voyage without a rejection strategy re-introduces the same false-positive rate.
- **Latency/throughput:** measure query-embedding latency and search latency
  under load; Voyage adds a network round-trip per query (vs local BGE).

## 7. Cutover

- Flip the read space with a config change: set the active
  `EMBEDDING_SPACE_ID` to the Voyage space and `EMBEDDING_PROVIDER=voyage`
  (production env change — **requires explicit approval; not done here**).
- Deploy behind a runtime flag so the switch can be reverted without a rebuild.
- Cut over reads first against the fully backfilled table; writes follow (new
  documents embed in the active space). Monitor error rate, latency, token usage.

## 8. Rollback

- Because the target schema is additive and the legacy `chunks.embedding` (BGE)
  is retained until cleanup, rollback = flip the active space flag back to BGE
  and restart. No data loss, no re-embedding.
- Rollback triggers: eval regression below baseline, latency SLO breach, Voyage
  error/rate-limit storm, or cost overrun.
- **Cleanup (only after a quiet rollback window):** drop the legacy
  `chunks.embedding` (BGE) column and remove the dual-write flag. `chunk_embeddings`
  (Voyage) is retained. This is the first irreversible step and should itself be a
  reviewed migration. See Stage 6 in the Stage 0 design.

## 9. Prerequisites / open risks

- **Resolved (design):** target schema corrected to an indexable `vector(1024)`
  with a per-space partial HNSW index — see
  [`voyage-migration-stage-0-design.md`](./voyage-migration-stage-0-design.md).
  The design choice (shared vs per-space tables) and numeric gates are still
  **proposed** pending review.
- A migration **runner** (or documented, repeatable apply procedure) for
  `database/migrations/*.sql`.
- Production rate-limit tier confirmed with Voyage; token budget approved.
- Query-latency SLO defined for the added network hop.
- Decision on cross-document retrieval scope and no-answer rejection.
- Fix or temporarily disable `POST /:id/chunk` / `POST /:id/embed` before the
  dual-write window (they bypass re-embedding today).
- Evaluation corpus large enough to trust the small staging win (§9 of
  `docs/retrieval-evaluation.md`). The current 20-case fixture is not decisive.
- Nothing here authorizes touching production env vars, the production database,
  or a production migration.
