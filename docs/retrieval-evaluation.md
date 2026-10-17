# Retrieval evaluation plan (BGE 384 vs Voyage 1024)

**Status: proposed tooling, not yet run against a seeded dataset.** This document
describes how the two embedding spaces are compared fairly, what is measured, and
how to budget and run the comparison **offline first**. No Voyage or other paid
API calls are made by anything described here, and nothing here changes the
staging or production databases.

The goal is a decision-quality comparison of **retrieval quality only**. It does
not evaluate the answer-generation model, and it never prompts an LLM.

## 1. Fairness protocol

The comparison is only meaningful if the two spaces differ **solely** in the
embedding provider. Enforced by the tooling:

- **Same corpus.** Both runs read the same documents and chunking.
  `embedding-retrieval-eval` queries the baseline `chunks` table (BGE space) or
  the `embedding_shadow_chunks` table filtered to one space (`--space`), but the
  underlying documents and chunk boundaries are identical.
- **Same queries and labels.** One `--cases` file is used for both runs, so the
  query strings and relevance labels are byte-for-byte identical.
- **Same settings.** `--top-k`, `--min-recall`, and `--no-answer-threshold` are
  passed identically. Time is the only variable.
- **No threshold leakage.** Cosine similarity is **not** comparable across
  embedding spaces, so no-answer queries are never judged by an absolute cosine
  cutoff. They are judged by whether the no-answer similarity distribution is
  **separable** from the answerable one *within the same space* (see §4).
- **One space per run.** A run fails if any retrieved row reports a space other
  than the selected one (`allSingleSpace`), so a half-migrated table can never
  produce a passing score.

## 2. Dataset

The current staging fixture (`staging-retrieval-cases.resolved.json`) is too small
(6 answerable + 1 unanswerable) and homogeneous for a decision. The proposed
replacement is `scripts/dev/fixtures/retrieval-eval-plan.json`:

| Kind | Purpose | Proposed cases |
| --- | --- | --- |
| `answerable` | single-fact lookups with one clear answer | 10 |
| `ambiguous` | several defensible chunks/documents; graded relevance | 2 |
| `cross-chunk` | answer needs two chunks of the same document | 2 |
| `cross-document` | answer needs two different documents | 2 |
| `unanswerable` | facts absent from the corpus (no-answer behaviour) | 5 |

Design rules:

- Queries are written the way a user would ask, not copied from the source text.
- Labels are attached by **exact text markers**, then resolved to concrete
  `(documentId, chunkIndex)` pairs by `scripts/dev/lib/resolve-cases.mjs`. A
  marker that no longer matches fails loudly, so labels cannot silently drift.
- Relevance is **graded** (3 = directly answers, 1 = related). This lets nDCG
  distinguish "found the right chunk" from "found a vaguely related one".

The fixture is a **proposal** (`"status": "proposed-not-seeded"`). It is not
inserted into any database and is validated and budgeted entirely offline.

## 3. Metrics

Computed per case by `scripts/dev/lib/retrieval-metrics.mjs` and aggregated as a
macro average (each case weighted equally):

- **Recall@k** — fraction of labelled relevant items present in the top *k*.
- **Precision@k** — fraction of the top *k* that are relevant.
- **MRR** — reciprocal rank of the first relevant item.
- **nDCG@k** — graded, rank-discounted gain normalised by the ideal ordering.
- **Hit rate@k** — share of queries with at least one relevant item in the top *k*.

Reported overall and **per kind**, so a win on easy factual lookups cannot hide a
regression on cross-chunk or ambiguous queries against the `payload.tail` shape.

## 4. No-answer behaviour

Because absolute cosine values are space-specific, no-answer quality is measured
as **separability**:

- `maxNoAnswer` — highest top-1 similarity among unanswerable queries.
- `minAnswerable` — lowest top-1 similarity among answerable queries.
- `margin = minAnswerable − maxNoAnswer`; `separated = margin > 0`.
- **False-positive rate** at an optional threshold (`--no-answer-threshold`): the
  share of unanswerable queries whose top-1 *would* be accepted.

A space that "answers" no-answer queries is worse even if its Recall@k is higher,
so separability and FPR are reported next to recall rather than folded into it.

## 5. Retrieval quality ≠ generation quality

This plan scores **only** whether the right chunks are retrieved. Answer
faithfulness, hallucination, and citation quality belong to a separate evaluation
that calls the generation model; mixing them makes a retrieval regression
impossible to see. Keep the two tracks independent. A retrieval comparison here
is a valid input to the provider decision on its own.

## 6. Token and cost budgeting (before any live call)

Voyage usage is estimated **offline** before spending anything:

1. Seed/resolve the corpus (offline resolve of the plan is also available):
   `node scripts/dev/seed-eval-corpus.mjs --dry-run --database-url "$STAGING_URL"`
2. Print the request/token plan without touching the network or DB:
   `node scripts/dev/embedding-retrieval-eval.mjs --plan --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json`

`--plan` uses a conservative ~4-characters-per-token heuristic
(`scripts/dev/lib/token-estimate.mjs`) and reports query tokens, request count,
and whether a corpus re-embed is included. It is **an estimate, not a
measurement**; real usage comes from `VoyageProvider.getUsageSnapshot()` after a
run.

To avoid re-embedding queries on repeat runs, pass a cache:
`--query-cache <file.json>` maps `caseId → query vector`. Cached queries are
reported (`cachedQueryVectors`) and cost nothing.

Prefer offline / cached evaluation:
- Use the baseline (`huggingface`/local) provider for repeat runs — zero API cost.
- For Voyage, resolve and budget with `--plan` first, then run once with a query
  cache and a small `--delay-ms` to respect rate limits.

## 7. Deterministic tests and fixtures

Pure modules are unit-tested with no I/O or network:

- `tests/retrieval/retrieval-metrics.test.js` — relevance maps, Recall/MRR/nDCG,
  and no-answer separability/FPR.
- `tests/retrieval/token-estimate.test.js` — heuristic token accounting.
- `tests/retrieval/resolve-cases.test.js` — marker resolution, legacy fixtures,
  and a validation pass over the whole proposed plan fixture.

These run under `node --test` and are the only place synthetic data is used; live
evaluation always uses the real corpus.

## 8. How to run a comparison

All commands target the disposable staging DB and never touch production.

```
# 1. Seed the evaluation corpus (adds only new "action": "seed" docs; reuses the
#    existing embedded docs untouched; resolves labels against the DB)
node scripts/dev/seed-eval-corpus.mjs --dry-run --database-url "$STAGING_URL"
node scripts/dev/seed-eval-corpus.mjs --database-url "$STAGING_URL"

# 2. Offline budget for the Voyage pass (no DB, no network)
node scripts/dev/embedding-retrieval-eval.mjs --plan \
  --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json

# 3. Baseline space (BGE), no paid calls
node scripts/dev/embedding-retrieval-eval.mjs --database-url "$STAGING_URL" \
  --provider local --source baseline --top-k 5 \
  --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json \
  --out reports/retrieval-eval/bge-baseline.json

# 4. Voyage (billable, approved): migrate new docs, build a batched query cache,
#    then evaluate with zero extra calls.
node --env-file=.env scripts/dev/embedding-migration.mjs --apply --confirm-disposable \
  --provider voyage --database-url "$STAGING_URL"
node --env-file=.env scripts/dev/voyage-query-cache.mjs \
  --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json --out /tmp/voyage-query-cache.json
node --env-file=.env scripts/dev/embedding-retrieval-eval.mjs --database-url "$STAGING_URL" \
  --provider voyage --source shadow --space voyage-4-lite-query-document-l2-1024-v1 \
  --top-k 5 --query-cache /tmp/voyage-query-cache.json \
  --cases scripts/dev/fixtures/retrieval-eval-cases.resolved.json \
  --out reports/retrieval-eval/voyage.json
```

The migration tool only processes documents without a `completed` progress row
for the target space, so reusing existing shadow embeddings is automatic. The
baseline and Voyage runs must use identical `--cases`, `--top-k`, and
`--min-recall` values.

## 9. Current evidence (staging, 20-case fixture)

Fair (same 6-document pool) comparison on the 20 resolved cases; full detail in
`reports/retrieval-eval/comparison.md`.

| Metric | BGE (384-d) | Voyage (1024-d) |
| --- | --- | --- |
| Recall@5 | 0.9281 | 0.9594 |
| Precision@5 | 0.2875 | 0.3000 |
| MRR | 0.9375 | 0.9688 |
| nDCG@5 | 0.9035 | 0.9447 |
| Hit@5 | 1.0 | 1.0 |
| No-answer separated | no (margin −0.1096) | no (margin −0.2939) |

Voyage is modestly ahead on graded/order metrics on this tiny fixture. Neither
model separates answerable from unanswerable queries, so no fixed cosine
threshold is usable. This is **not** sufficient to justify a production cutover;
it is enough to proceed with the migration planning in
`docs/voyage-production-migration-plan.md`.

## 9b. Open items

- Grow the corpus well beyond the 6-doc fixture before trusting the win margins.
- Decide a `--top-k` and `--min-recall` acceptance bar per kind.
- Decide how to reject unanswerable queries (rerank / judge / per-space tuned
  threshold) — neither bi-encoder separates them today.
- Confirm whether cross-document queries are in scope for the product's
  single-document answer path before weighting them.
