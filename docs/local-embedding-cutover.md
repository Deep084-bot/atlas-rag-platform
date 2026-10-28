# Local BGE cutover: hosted -> local

**Status: not executed.** Production remains on
`EMBEDDING_PROVIDER=huggingface`. This document is the implementation and
rollback design for a later, explicitly approved cutover.

## Space identities

| Space | ID | Provider | Notes |
| --- | --- | --- | --- |
| Hosted BGE | `bge-small-en-v1.5-hosted-l2-v1` | `huggingface` | `BAAI/bge-small-en-v1.5`; existing legacy rows may belong here but are unproven |
| Local BGE INT8 | `bge-small-en-v1.5-mean-l2-int8-v1` | `local` | Pinned Xenova ONNX revision, mean pooling, int8, L2 |
| Legacy unknown | `NULL` | unknown | Not searchable or countable by default; never assumed to belong to either BGE space |

Hosted and local use the same 384 dimensions but are separate spaces. No
equivalence claim is made without a successful hosted-vs-local probe. As of this
work, the hosted endpoint returned HTTP 402, so that evidence is still missing.

## Write and read behavior

- New hosted writes set `chunks.embedding_space_id` to the hosted ID.
- New local writes set it to the local ID.
- Re-embedding an existing chunk overwrites both the vector and its space tag in
  one `UPDATE`.
- The default policy is `EMBEDDING_LEGACY_UNKNOWN_POLICY=block`: `NULL` legacy
  rows are not searched, counted as embedded, or treated as compatible.
- `EMBEDDING_LEGACY_UNKNOWN_POLICY=include` is a temporary, hosted-only
  compatibility mode for existing production rows that are believed to be
  hosted but lack provenance. It is rejected for local/Voyage and must be removed
  after every row is backfilled.
- Local retrieval requires local rows and errors if any `NULL`/hosted rows remain.
- Any mismatch blocks search with a sanitized 503 before calling the embedding
  provider; no query is compared against mixed spaces.
- The compatibility check is global, not per user. One incompatible stored vector
  blocks search for every user until it is re-embedded or provenance is restored.

## Preconditions

1. **Inventory first.** Record chunk counts, documents, vector dimensions, index
   names, and how many rows have `embedding IS NOT NULL`. Do not assume existing
   vectors are hosted; that provenance is unproven unless operational evidence
   exists.
2. Take a verified backup/PITR checkpoint and validate restore access.
3. Apply `database/migrations/20261027_add_chunk_embedding_space.sql` to a
   disposable/staging clone, then to production **before** deploying code that
   reads or writes `embedding_space_id`. It is additive and does not rewrite
   vectors, but it is not zero-downtime on a large table: build the index with
   `CREATE INDEX CONCURRENTLY` outside a transaction after the column exists.
   `database/schema.sql` is bootstrap-only and cannot migrate an existing DB.
4. Build and verify the pinned cache:
   `node scripts/dev/embedding-artifacts.mjs --cache-dir ./model-cache --download --check-env`.
5. Confirm the target has no production credentials and run the integration suite.
6. Establish a retrieval baseline dataset and hosted/local equivalence evidence.
   Without hosted API access, do not claim equivalence.
7. Approve an operator-grade re-embedding workflow. See
   [`docs/production-reembedding-design.md`](./production-reembedding-design.md).
   No checked-in script is cleared to bulk-write production vectors.

## Staged cutover

1. **Deploy schema + code with `huggingface` still active.** New hosted writes are
   tagged; old rows remain `NULL`. If search must remain available during this
   window, temporarily set `EMBEDDING_LEGACY_UNKNOWN_POLICY=include` after
   confirming the legacy rows are hosted. Do not deploy this code without the
   column and index already in place.
2. **Backfill provenance for hosted rows.** Re-embed or otherwise prove and tag
   every hosted vector, then switch back to `EMBEDDING_LEGACY_UNKNOWN_POLICY=block`
   and verify the compatibility check reports zero incompatible rows.
3. **Re-embed in a staging clone with the local provider.** Every chunk must
   receive the local tag; verify chunk counts and L2 norms.
4. **Run retrieval checks on staging.** Confirm the local guard reports zero
   incompatible rows and compare quality against the hosted baseline.
5. **Choose a write-freeze/cutover window for production.** Do not bulk re-embed
   production without explicit approval and a backup.
6. **Re-embed production and verify.** Local search remains blocked until no
   incompatible rows remain. Then switch `EMBEDDING_PROVIDER=local` and run smoke
   checks for ingestion and retrieval.
7. **Keep the hosted vectors archived** until local retrieval is accepted. The
   provenance tags make mixed states visible rather than silently comparable.

## Rollback

- **Never roll back application code to a commit that predates provenance.**
  After any tagged write exists, old code can read across spaces and its
  `updateChunkEmbedding` does not set a tag. Keep the provenance-aware code
  deployed and roll back only provider/configuration settings.
- Before any production re-embed: keep `huggingface`; the additive column is
  backward-compatible. Use the explicit hosted compatibility mode only while
  legacy `NULL` rows are expected, then remove it after backfill.
- After partial local re-embed: keep local search blocked, switch the provider
  back to `huggingface`, and re-embed the locally tagged rows with hosted vectors
  (or restore from a validated backup). Hosted search will report the local rows
  as incompatible until they are re-tagged.
- Do not delete `chunks.embedding` or the provenance column as part of a normal
  rollback.
- Dropping `chunks.embedding_space_id` or its index is destructive, requires the
  application to stop reading provenance first, and discards the evidence needed
  for a safe recovery. Do it only under a separate approved migration after a
  full re-embed/rebaseline, never as an emergency rollback step.

## Render Free acceptance criteria

These are requirements, not measured results:

- Build step downloads/verifies the pinned bundle; no `/var/data` dependency.
- Runtime env sets `EMBEDDING_PROVIDER=local`, `EMBEDDING_CACHE_DIR=/app/model-cache`
  (or the bundle path), `EMBEDDING_BUNDLED_CACHE_DIR=/app/model-cache`,
  `EMBEDDING_LOCAL_ALLOW_REMOTE=false`, and `EMBEDDING_LOCAL_STRICT=true`.
- `EMBEDDING_PROVIDER=huggingface` remains the production setting until cutover.
- On linux/amd64 with `--memory=512m --cpus=0.1 --network none`:
  - cold and warm model initialization succeed from the bundle;
  - a small embedding batch and a concurrent embedding+OCR path complete;
  - no OOM, no runtime model download, no `/var/data` access;
  - record cold/warm latency, RSS, and max RSS.
- Re-run the same checks on Render's actual AMD64 Free instance before claiming
  readiness. The documented arm64/0.1-CPU measurements are not sufficient.

## Known blockers

- Hosted HF API returned 402, so hosted/local retrieval equivalence is unmeasured.
- No local linux/amd64 Docker daemon run was available in this environment.
- Production Render build/start commands are not recorded in the repository.
- The compatibility check is a global aggregate; large tables need a deliberate
  scoped/indexed query design before relying on it during peak traffic.
- There is no zero-downtime migration proof for the column/index change.
- No operator-grade production re-embedding tool is implemented; only the design
  in [`docs/production-reembedding-design.md`](./production-reembedding-design.md).
- GitHub CI has not run for this branch.
