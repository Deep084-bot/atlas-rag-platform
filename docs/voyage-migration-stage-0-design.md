# Voyage production migration — Stage 0 design (dual-space storage)

Status: **design only. Nothing here has been implemented, applied, or deployed.**
Production (`DATABASE_URL` → Neon) is untouched. This is the Stage 0 output of the
plan in [`voyage-production-migration-plan.md`](./voyage-production-migration-plan.md);
it replaces the defective target schema in §3 of that plan (see §2 below).

The recommendation in §4 is **proposed** and must be reviewed and approved before
any Stage 1 work begins. All numeric gates marked **(proposed)** are unratified.

---

## 1. Scope

Choose the physical storage model for the second embedding space (Voyage,
1024-d) that coexists with the live BGE space (384-d), such that:

- the cutover is a reversible configuration change, not a data migration;
- no BGE and Voyage vectors ever share a comparison;
- the new store is indexable and query-isolatable;
- the same model extends to future embedding models with other dimensions.

Out of scope: query generation, the no-answer rejection model, production
rate-tier procurement, and the migration runner itself (tracked in the plan §9).

---

## 2. Empirically verified constraints

These were reproduced on a throwaway database (`atlas_pgvector_scratch`, created
and dropped; staging untouched) with **PostgreSQL 18.3 / pgvector 0.8.6**. They
bound every design below.

| # | Claim | Evidence |
| --- | --- | --- |
| V1 | `vector(384)` rejects 1024-d vectors. | `INSERT INTO t384 VALUES (2, <1024-d>)` → `ERROR: expected 384 dimensions, not 1024` |
| V2 | An un-dimensioned `vector` column accepts any dimension but **cannot be indexed**. | `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` → `ERROR: column does not have dimensions` (IVFFlat identical) |
| V3 | A fixed `vector(1024)` column with a **partial** HNSW index scoped by space builds. | `CREATE INDEX ce_hnsw ON ce USING hnsw (embedding vector_cosine_ops) WHERE space_id = '<voyage-space>'` → `CREATE INDEX` |
| V4 | A per-space `vector(1024)` table with HNSW builds. | `CREATE INDEX ce1024_hnsw ON chunk_embeddings_1024 USING hnsw (embedding vector_cosine_ops)` → `CREATE INDEX` |

Consequence: the `embedding vector NOT NULL` column proposed in
`voyage-production-migration-plan.md` §3 (no dimensions) is **not implementable**;
it defines a store that can be written but never indexed, so retrieval would
seq-scan. The plan §3 is corrected to point here.

---

## 3. Design options

Both options share the same principles: a row's vector is always labelled with
the space that produced it, vectors are physically typed so the dimension is
fixed per relation, and the read path selects exactly one source.

### A. Separate dimensionally typed tables per embedding space

One table per space (or per dimension), each with a fixed `vector(N)` column and
its own HNSW index. Example:

```sql
CREATE TABLE chunk_embeddings_bge   (chunk_id uuid REFERENCES chunks(id) ON DELETE CASCADE,
                                     embedding vector(384)  NOT NULL, ...);
CREATE TABLE chunk_embeddings_voyage(chunk_id uuid REFERENCES chunks(id) ON DELETE CASCADE,
                                     embedding vector(1024) NOT NULL, ...);
-- one HNSW index per table, no predicate required
```

### B. Shared Voyage `chunk_embeddings` table, `vector(1024)`, BGE preserved separately

One new table typed `vector(1024)` hosting Voyage (and any future 1024-d space),
selected by `space_id`; BGE remains in the existing `chunks.embedding vector(384)`
column untouched. A **partial** HNSW index per space keeps isolation and
indexability:

```sql
CREATE TABLE chunk_embeddings (
  chunk_id    uuid NOT NULL REFERENCES chunks(id)     ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id)  ON DELETE CASCADE,
  space_id    text NOT NULL,
  embedding   vector(1024) NOT NULL,
  l2_norm     double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, space_id)
);

CREATE INDEX chunk_embeddings_doc_idx
  ON chunk_embeddings (document_id, space_id);

CREATE INDEX chunk_embeddings_voyage_hnsw
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE space_id = 'voyage-4-lite-query-document-l2-1024-v1';
```

### Comparison

| Dimension | A — per-space typed tables | B — shared 1024 table + partial index |
| --- | --- | --- |
| **Schema evolution** | New table per space; additive; must also create a BGE table or leave BGE in legacy (hybrid). | One additive table now; new 1024-d space = new partial index only; non-1024 model = new typed table. |
| **Index behavior** | Simple per-table HNSW; no predicate; planner cannot accidentally cross-space. | Partial HNSW requires the `space_id = $active` predicate to be used; must verify with `EXPLAIN`. |
| **Query isolation** | Isolation is physical (table choice). Strongest. | Isolation is by mandatory predicate + partial index; correct if the predicate is never omitted. |
| **Ingestion** | Write to active table (and dual-write during transition). | Write to `chunk_embeddings` (and legacy `chunks.embedding` during transition). |
| **Resumable backfill** | Target table only; progress keyed by space+document. | Same; progress keyed by space+document; reuses existing staging tool shape. |
| **Deletion/update propagation** | Per-table FK `ON DELETE CASCADE`; re-chunk cascades within the table. | Single table FK cascades; re-chunk cascade removes stale rows in one place. |
| **Rollback** | Flip read target back to the BGE table (or legacy). Requires BGE table to exist. | Flip read target back to `chunks.embedding`. BGE never moved → cheapest, safest rollback. |
| **Future models, other dims** | New table per new dimension; uniform model. | Same-dim reuses table + index; other dims need a new typed table. |
| **Main risk** | Requires rehoming/duplicating BGE to be fully uniform, or degrading to a hybrid anyway. | Relies on the space predicate never being dropped; one omission could surface cross-space rows. |

---

## 4. Recommendation (proposed)

**Adopt Design B for this migration, built so it generalizes toward Design A.**

Rationale:

1. **Rollback is the binding constraint.** The plan's invariant is a proven,
   zero-re-embedding rollback. B leaves `chunks.embedding` (BGE) untouched, so
   rollback is a flag flip with no data movement. A requires the BGE space to
   also live in a new typed table (extra migration + 384-d backfill) or it
   collapses back into a hybrid, so it does not actually remove the legacy
   column during the transition window.
2. **B is verified-indexable** (V3) and satisfies the review's critical findings:
   space-labelled rows, fixed-dimension column, mandatory space predicate.
3. **B is the better fit for the likely near-term future** — additional 1024-d
   Voyage models only need a new partial index and registry entry.
4. **A remains the long-term direction** once BGE is decommissioned or a
   non-1024 model arrives; at that point we promote to per-dimension typed
   tables (`chunk_embeddings_384`, `chunk_embeddings_1024`, …) and drop the
   legacy column. Promotion trigger and path are documented in §5.8.

The residual risk in B (dropping the `space_id` predicate) is mitigated by: a
single code path that constructs the predicate, a startup assertion, and an
explicit isolation acceptance test (§6, AC-ISO).

---

## 5. Detailed design (Design B)

### 5.1 Space registry

Introduce a single source of truth mapping each space to its storage target,
dimensions, and input types. `chunk_embeddings` (1024) serves 1024-d spaces;
BGE continues to resolve to the legacy `chunks.embedding` path until promotion.

| space_id | storage | dims | query input | document input |
| --- | --- | --- | --- | --- |
| `bge-small-en-v1.5-hosted-l2-v1` | `chunks.embedding` (legacy) | 384 | none (BGE v1.5) | none |
| `bge-small-en-v1.5-mean-l2-int8-v1` | `chunks.embedding` (legacy) | 384 | none (BGE v1.5) | none |
| `voyage-4-lite-query-document-l2-1024-v1` | `chunk_embeddings` (Voyage) | 1024 | `query` | `document` |

The active space is chosen by explicit config, not inferred from
`EMBEDDING_PROVIDER` alone (addresses review M2). Query vs document input type
is bound at the call site, never by a global env var (addresses review M1).

### 5.2 Query isolation (read path)

Two explicit read implementations, selected by the active space's storage
target; **never** a join or `UNION` across sources:

- **BGE space** → legacy `chunks.embedding <=> $1::vector(384)` (unchanged).
- **Voyage space** → `... FROM chunk_embeddings WHERE space_id = $active AND
  embedding <=> $2::vector(1024)`.

Rules:

- The query vector is produced by the **same** space/input type as the stored
  vectors.
- The `space_id = $active` predicate is mandatory and constructed in one place.
- **No silent fallback.** If Voyage is unavailable, the request errors or the
  operator flips the active space back to BGE; the system never embeds a query
  with a different model to satisfy a request.

### 5.3 Ingestion

- `embeddingService.embedDocument()` writes batch **upserts** into
  `chunk_embeddings` keyed `(chunk_id, space_id)` using the space's
  `documentInputType`, in a transaction per batch so a mid-batch failure cannot
  leave a partial batch.
- During the transition window, a **dual-write flag** keeps updating the legacy
  `chunks.embedding` column so BGE retrieval stays correct until cutover.
- Standalone endpoints must be brought onto the same path before Stage 2:
  `POST /:id/chunk` replaces chunks without re-embedding and `POST /:id/embed`
  runs independently today (review H1/H2). Both must write through the active
  space and re-embed replaced chunks, or be disabled during the window.

### 5.4 Resumable backfill

- Per-document progress rows keyed `(space_id, document_id)` with status
  `pending | in_progress | completed | failed`, plus `chunk_count` and measured
  `token_count` (mirrors `embedding_migration_progress`).
- Idempotent: upsert on `(chunk_id, space_id)`; re-running never duplicates.
- Resumable: `completed` documents are skipped; `in_progress`/`failed` resume.
- Scoped to `documents.status = 'ready'` only (review H4), so failed/unembedded
  documents are never mis-ingested. Eligibility is enforced by the backfill
  runner itself, not only by the enumeration query: the runner revalidates the
  document under its row lock before claiming and again before every provider
  batch, and returns an explicit `ineligible` result otherwise (see
  `server/embeddings/embeddingEligibility.js`). The operator/migration path uses
  the `operator` policy (`ready` only); the inline ingestion/re-embed path uses
  the `general` policy, which additionally allows `embedding` so an in-flight
  reprocess can complete. Any other, missing, or unknown status fails closed.
- Rate budget: honor `Retry-After`, enforce RPM/TPM across the job; use a paid
  tier for production scale (trial 3 RPM / 10K TPM is not viable).

### 5.5 Deletion and update propagation

- `chunk_embeddings.chunk_id → chunks(id) ON DELETE CASCADE`: deleting a chunk
  removes its vectors.
- `document_id → documents(id) ON DELETE CASCADE`: document deletion removes all
  its rows.
- Re-chunk (`ChunkRepository.replaceDocumentChunks`) deletes chunks, cascading
  stale rows away; the orchestrator re-embeds the new chunks. A recurring orphan
  check (below) guards against regressions.
- Orphan check: `SELECT count(*) FROM chunk_embeddings ce LEFT JOIN chunks c ON
  c.id = ce.chunk_id WHERE c.id IS NULL` must be `0`.

### 5.6 Rollback

- Rollback = set the active space back to BGE and restart. Reads use
  `chunks.embedding`; `chunk_embeddings` is ignored but retained.
- No data loss, no re-embedding. This is the reason B is preferred.
- **Cleanup is the first irreversible step** (drop the Voyage table and/or the
  legacy column) and must be a separately reviewed migration executed only after
  a quiet rollback window.

### 5.7 Failure behavior

- Mid-document failure marks the document `failed` with a classified reason and
  does **not** insert partial vectors for that document's remaining chunks
  (batch transaction) and never falls back to BGE.
- Retries are explicit; the current `reconcileStuckDocuments` only transitions
  stuck docs to `failed` and does not retry embedding (review H3), so the backfill
  job — not the reconciler — owns retries during migration.

### 5.7b Startup assertion

On boot, assert: the configured active space exists in the registry; its storage
target exists; the target's column dimension equals the space's dimensions; and,
for Voyage, the matching partial index exists. Refuse to serve otherwise
(addresses review M2/M3/L2).

### 5.8 Future models with other dimensions

- **Another 1024-d space** → add a partial HNSW index `WHERE space_id = '<new>'`
  and a registry entry. No schema change, no code branch.
- **A non-1024 model** → add a typed table for that dimension (this is Design A's
  pattern). The registry maps space → table.
- **Promotion to Design A** (proposed trigger: BGE decommissioned, or a third
  space with a non-1024 dimension ships): create per-dimension typed tables,
  migrate/keep BGE accordingly, drop the legacy `chunks.embedding` column as a
  reviewed destructive migration.

---

## 6. Staged implementation plan and acceptance criteria

No stage proceeds until the prior stage's criteria pass **and** the gate is
approved. Thresholds marked **(proposed)** are not ratified.

### Stage 0 — Design lock (this document)

- **AC0.1** Design and this doc reviewed and approved; BGE preserved as the live
  space; production untouched.
- **AC0.2** Constraints V1–V4 accepted as design inputs.
- **AC0.3** Chosen schema applies cleanly to a scratch DB and builds its index
  (already demonstrated, V3/V4).

### Stage 1 — Additive schema + index

- **AC-SCHEMA-1** Migration is additive only: no `ALTER`/`DROP` on existing
  columns; `\d chunks` unchanged.
- **AC-SCHEMA-2** `chunk_embeddings.embedding` has type `vector(1024)` and the
  partial HNSW index exists with predicate `space_id = '<voyage-space>'`.
- **AC-SCHEMA-3** Inserting a 384-d vector into `chunk_embeddings` fails
  (dimension guard).
- **AC-SCHEMA-4** No rows written by the migration; `count(chunks)` and
  `count(chunks WHERE embedding IS NOT NULL)` unchanged.

### Stage 2 — Versioned write path (dual-write, flag off)

- **AC-WRITE-1** Flag OFF: embedding a document writes **zero**
  `chunk_embeddings` rows.
- **AC-WRITE-2** Flag ON: embedding a document writes exactly one row per chunk
  for the active space **and** still updates `chunks.embedding`.
- **AC-WRITE-3** Idempotency: embedding the same document twice yields the same
  row count and byte-identical vectors (upsert, no duplicates).
- **AC-WRITE-4** Query/document input types are bound per call site; no config
  value can make a query embed as `document`.

### Stage 3 — Resumable backfill

- **AC-BACKFILL-1** After backfill:
  `count(chunk_embeddings WHERE space=<voyage>)` equals
  `count(chunks JOIN documents WHERE status='ready')`.
- **AC-BACKFILL-2** Resume: interrupting mid-run and re-running produces no
  duplicates, skips completed documents, and reaches the same final count.
- **AC-BACKFILL-3** Every row: `dimensions = 1024`, `abs(l2_norm-1) <= 0.01`,
  `embedding IS NOT NULL`.
- **AC-BACKFILL-4** `token_count` equals measured provider usage; no request
  fails after honoring `Retry-After` within budget.
- **AC-BACKFILL-5** Documents with `status != 'ready'` produce no rows.

### Stage 4 — Validation and cutover readiness

- **AC-EVAL** On a production-equivalent corpus, Voyage Recall@5 ≥ BGE baseline
  **and** nDCG@5 ≥ BGE baseline − 0.01 **(proposed)**.
- **AC-NOANSWER** A no-answer rejection strategy is chosen and measured; the
  chosen gate meets its target false-positive rate **(proposed)**.
- **AC-LATENCY** p95 query embed+search ≤ BGE p95 + 150 ms; p99 ≤ 500 ms
  **(proposed)**.
- **AC-PLAN** `EXPLAIN (ANALYZE)` on a Voyage query uses the partial HNSW index,
  not a sequential scan or a post-filter that reads other spaces.

### Stage 5 — Cutover and rollback

- **AC-CUTOVER-1** Flag flip to Voyage: reads return only Voyage-space results;
  `chunks.embedding` untouched; API contract unchanged.
- **AC-ISO** Isolation: with two spaces present, a query in space X never returns
  a row from space Y, including at the index level.
- **AC-ROLLBACK-1** Flag flip back to BGE restores pre-cutover results exactly;
  zero data loss; no re-embedding.
- **AC-ROLLBACK-2** Startup assertion refuses to serve on a space/dimension/index
  mismatch.
- **AC-LIFECYCLE** Post-cutover: new documents appear in Voyage results; deleting
  a chunk and deleting a document remove their `chunk_embeddings` rows;
  `AC-ORPHAN` (orphan count `= 0`) holds.

### Stage 6 — Cleanup (irreversible; separate review)

- **AC-CLEANUP** Only after the quiet window and explicit approval: drop the
  legacy column/BGE rows and remove the dual-write flag; rollback is no longer
  possible past this point.

---

## 7. Relationship to the implementation plan

- Supersedes `voyage-production-migration-plan.md` §3 (the un-dimensioned
  `embedding vector` DDL) and refines §4–§8 with concrete storage, isolation,
  and acceptance criteria.
- Does not change the plan's invariants, runbook ordering, or the requirement for
  a migration runner (§9 there).

---

## 8. Unresolved decisions

1. Ratify Design B vs A (this doc proposes B).
2. Ratify the numeric gates marked **(proposed)** (quality, latency, no-answer).
3. No-answer rejection strategy (threshold vs reranker vs LLM judge).
4. Whether to fix or temporarily disable `POST /:id/chunk` and `POST /:id/embed`
   during the transition window.
5. Automatic retry policy for `failed` documents during backfill.
6. Equivalent-corpus definition and size for the eval gate.
7. Production Voyage rate tier and token budget owner.
8. Governance of the irreversible Stage 6 cleanup.
