# Production re-embedding: design and implementation plan

**Status: design only. Not implemented, not approved, and never run against
production.** Production remains on `EMBEDDING_PROVIDER=huggingface`. This
document defines the safeguards a future operator-grade workflow must implement
before any production vector is rewritten.

## 1. Scope and non-goals

The workflow must be able to re-embed an existing corpus into a new embedding
space (local BGE or Voyage) with:

- a read-only dry-run inventory;
- explicit operator approval and target verification;
- resumable, idempotent, rate-limited execution;
- per-document atomicity and provenance validation;
- retrieval-quality gates before cutover;
- a tested recovery path for partial failure.

Non-goals:

- No zero-downtime claim is made. The current schema and read path have not been
  proven safe for an online conversion.
- No silent fallback to another provider or space.
- No production writer is added by the remediation that created this document.
- No production migration is authorized by this document.

The existing staging tools (`scripts/dev/embedding-migration.mjs`,
`scripts/dev/embedding-backfill*.mjs`) are **not** production tools. The shadow
tool writes only to `embedding_shadow_chunks` and refuses production-like
targets. The per-document `POST /documents/:id/embed` route is not an operator
bulk workflow.

## 2. Existing primitives and gaps

Useful primitives already in the repository:

- Active-space resolution in `server/embeddings/embeddingSpaces.js`.
- Atomic vector + provenance writes in
  `EmbeddingRepository.updateChunkEmbedding()`.
- `chunk_embeddings` / shadow progress patterns and per-document advisory locks
  in the staging backfill runner.
- Fail-safe legacy `NULL` policy, search-space compatibility checks, and
  sanitized diagnostics.
- Read-only dry-run inspection for disposable targets.
- Disposable-database integration harness and migration guard.

Gaps that the production workflow must close:

- no production target allowlist beyond disposable-name rejection;
- no durable execution/checkpoint table for an operator run;
- no production rate-limit/token budget enforcement;
- no approval record, plan digest, or environment fingerprint;
- no verified retrieval-quality gate wired into execution;
- no tested backup/restore and partial-failure recovery drill;
- no zero-downtime path.

## 3. Safety model

A future implementation must satisfy all of the following:

1. **Never fall back to `DATABASE_URL`.** The target must be passed explicitly
   and independently verified by querying the connected database identity.
2. **Disposable by default.** Production execution requires a separate,
   production-only command/role, an explicit `--target-environment production`
   flag, a database-name allowlist, and an approval token supplied out of band.
3. **Read-only first.** Inventory and dry-run use a read-only database role and
   must never construct a provider or issue a write.
4. **Fail closed.** Unknown environment markers, missing approval, mismatched
   database identity, missing backup proof, or incompatible schema abort before
   the first write.
5. **No implicit provenance.** Every target row must receive the target
   `space_id` in the same statement/transaction as its vector. `NULL` is never
   accepted for new work.
6. **Retain provenance-aware code.** Never roll application code back to a
   pre-provenance commit after tagged writes exist.
7. **No mixing.** Search must use one space. If any incompatible row remains,
   the compatibility guard blocks retrieval rather than silently dropping or
   comparing it.
8. **No production by accident.** Tests must refuse production-like hosts and
   names, and CI must never receive production credentials.

## 4. Phased workflow

### Phase 0: preconditions

- Freeze schema changes and record the exact commit/image digest.
- Apply the provenance migration
  (`database/migrations/20261027_add_chunk_embedding_space.sql`) and verify the
  column/index. On a large table, build the index with `CREATE INDEX
  CONCURRENTLY` outside a transaction.
- Keep `EMBEDDING_PROVIDER=huggingface` until the cutover gate.
- Take a verified backup or PITR checkpoint and prove restore access. Record the
  backup identifier in the run manifest.
- Define the target space, model revision, input type, dimensions, normalization,
  and provider rate limits. Pin them; do not read them from mutable defaults at
  execution time.
- Confirm there is an operator, a reviewer, a rollback owner, and a maintenance
  window (or an explicitly tested online design).

### Phase 1: read-only inventory and dry run

The dry run must produce a machine-readable report and a human summary:

- document/chunk counts, eligible/ineligible documents, current provenance
  distribution, vector dimensions, and `NULL` counts;
- token estimate, request count, expected wall-clock, and cost at the configured
  batch size/rate limit;
- a sample of the exact text to be sent, plus a check for empty/excessively long
  chunks;
- schema compatibility, target database identity, migration version, and
  available disk for checkpoints/backups;
- retrieval baseline reference and the validation query set;
- an explicit list of blockers, not just warnings.

The plan digest must cover the target space, model revision, source/target
database fingerprints, query-set hash, batch/rate settings, and tool version.
Changing any of those invalidates the approval.

### Phase 2: explicit approval

Before writes, require all of:

- the dry-run report and plan digest reviewed by a second person;
- `--target-environment production` (or the exact non-production environment)
  and an explicit target argument;
- `--confirm-plan-digest <digest>`, supplied by the operator, not defaulted;
- an approval token from a secret manager/workflow, not an environment variable
  committed to the repository;
- confirmation that the database role is the intended write role and the
  connected database identity matches the allowlist;
- confirmation that the backup/PITR checkpoint is restorable;
- acknowledgement that hosted inference is currently unavailable (HTTP 402), so
  a hosted rollback cannot be assumed.

A production invocation with any flag missing exits before connecting to the
provider or writing.

### Phase 3: execution

Use a dedicated checkpoint table (design shown below; not yet implemented):

```sql
CREATE TABLE embedding_reembed_runs (
  run_id uuid PRIMARY KEY,
  plan_digest text NOT NULL UNIQUE,
  target_space_id text NOT NULL,
  target_environment text NOT NULL,
  database_fingerprint text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  last_heartbeat_at timestamptz,
  total_documents integer NOT NULL,
  completed_documents integer NOT NULL DEFAULT 0,
  failed_documents integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE embedding_reembed_checkpoints (
  run_id uuid NOT NULL REFERENCES embedding_reembed_runs(run_id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, document_id)
);
```

Execution rules:

- Process documents in a stable order; claim one document at a time with an
  advisory lock and a short lease. A crashed worker's lease expires and the
  document becomes retryable.
- Read chunks and write vectors per document in a transaction. Mark a document
  checkpoint complete only after every current chunk has the target vector and
  the target `space_id` in the same row.
- Use `(chunk_id, target_space)`-equivalent identity so retries are idempotent;
  never create a second current vector for the same chunk/space.
- Keep the old space intact until the cutover gate. Do not overwrite the only
  copy of a vector unless the run has a verified backup and a tested recovery
  path.
- Enforce request batch size, token budget, RPM/TPM, concurrency, and a
  server-side cooldown. Honor `Retry-After`; use bounded exponential backoff and
  jitter. Stop on repeated auth, dimension, or invalid-response errors.
- Record token usage as reported and flag when the provider does not report it.
- Persist progress after each document/batch; support resume by skipping
  completed checkpoints and retrying only failed/pending ones.
- Support a cooperative stop that finishes the current document, commits its
  checkpoint, and leaves the run resumable.
- Emit progress with counts, rate, ETA, error codes (not raw document text), and
  a heartbeat. Never log vectors, document content, credentials, or full URLs.

### Phase 4: validation

Validation runs after execution and again before cutover:

- **Coverage:** every eligible current chunk has exactly one target vector; no
  duplicate current rows; no `NULL` provenance in the target space.
- **Integrity:** dimensions match the target space; values are finite; L2 norms
  are within tolerance; vectors are not all-zero.
- **Provenance:** every target row has the intended `space_id`; legacy rows are
  still `NULL` or explicitly preserved; no foreign-space vector is used for
  retrieval.
- **Retrieval:** run a frozen query set against the target space and compare
  Recall@k/nDCG@k with the stored baseline. This requires a working baseline;
  hosted HF HTTP 402 currently prevents hosted/local equivalence measurements.
- **No-answer behavior:** evaluate the rejection strategy, not just retrieval.
- **Performance:** measure query and ingestion latency/throughput under expected
  load.
- **Recovery drill:** restore the backup into a disposable database and confirm
  the previous space still serves retrieval.

Any failed gate blocks the cutover. Do not "fix" it by lowering the threshold
without review.

### Phase 5: cutover gates

- Enter the approved write-freeze/maintenance window unless an online design has
  been implemented and tested.
- Run the final delta pass and stop ingestion writes.
- Re-run coverage/provenance validation and confirm the compatibility guard
  reports zero incompatible rows.
- Switch the provider/space configuration and application image together.
- Run ingestion and retrieval smoke checks with the target space.
- Monitor error rate, compatibility failures, latency, token usage, and ingestion
  status.
- Record the cutover timestamp and image/plan digest.

The current workflow does **not** prove zero-downtime cutover. Until an online
design is implemented and load-tested, do not promise it.

## 5. Partial failure and rollback

- A failed run stays resumable. Do not mark documents `ready` while chunks are
  missing target vectors; do not let the compatibility guard silently pass.
- Keep the last fully validated space serving traffic. If that is not possible,
  block search with the sanitized 503 rather than comparing mixed spaces.
- **Never roll back to pre-provenance application code.** Keep the
  provenance-aware code and change only provider/space configuration.
- After partial writes to a new space:
  - if the previous space is still intact and validated, keep serving it;
  - resume the target run if the failure was transient;
  - otherwise restore the verified backup into a disposable database first,
    validate, then perform the approved restore.
- Hosted HF currently returns HTTP 402. Do not assume a hosted re-embed can
  recover a failed local/Voyage migration. The fallback is the last validated
  space or a validated restore.
- Cleanup/drop of old columns, indexes, or vectors is a separate irreversible
  migration after a quiet rollback window. It must never be an emergency step.

## 6. Protection against production accidents

Implementation requirements before a production-capable command exists:

- Separate binary/script name for production; it must not be the staging tool
  with a flag that weakens the guard.
- Refuse `DATABASE_URL` as the target source. Require an explicit
  `--target-connection-secret` reference resolved from the deployment secret
  store.
- Verify `current_database()`, server address, role, and a configured
  database fingerprint; refuse staging/production-sounding names for test runs
  and disposable-sounding names for a production run.
- Require the dry-run digest, approval token, backup ID, and environment marker.
- Limit tests/CI to disposable databases and never inject production credentials.
- Default to read-only/dry-run; writes require the full approval set.
- Add a kill switch and a maximum-write/request budget.
- Log the plan digest, target fingerprint, and operator identity; do not log
  secrets or content.

## 7. Implementation plan

1. Add the checkpoint schema and a repository with run/lease semantics.
2. Add a read-only inventory command with a signed/recorded plan digest.
3. Add a target validator and production-command guard; test refusal paths first.
4. Add the executor with per-document atomicity, idempotent upserts, rate
   limiting, retries, resume, and cooperative stop.
5. Add validation/report commands for coverage, provenance, dimensions, norms,
   retrieval, and backup restore.
6. Add disposable-database integration tests for interruption/resume, duplicate
   delivery, 429/5xx retry, auth failure, dimension mismatch, zero-chunk
   documents, and rollback/restore.
7. Run a full rehearsal on a production-sized disposable clone, including a
   restore drill.
8. Obtain separate approval for any production migration, backup, run, cutover,
   or config change.

## 8. Open decisions

- Online dual-write vs write-freeze cutover; the latter needs a documented
  outage window.
- Where the approval token/backup proof lives and who can approve.
- Whether the target writes in place (`chunks.embedding` + provenance) or to a
  separate table with a dual-read switch.
- Retrieval acceptance thresholds and the no-answer strategy.
- Voyage rate-limit tier, token/cost budget, and concurrency.
- Retention period for old vectors and the irreversible cleanup gate.
