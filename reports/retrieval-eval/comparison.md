# BGE vs Voyage retrieval comparison (staging)

Generated from `reports/retrieval-eval/*.json`. Target database:
`localhost:5432/atlas_rag_staging` (disposable). Production was never touched.

## Method

- Same 20 resolved cases (`scripts/dev/fixtures/retrieval-eval-cases.resolved.json`),
  same relevance labels, same `--top-k 5`, same `--min-recall 1`.
- BGE: local provider (384-d), `--source baseline` (rows in `chunks.embedding`).
- Voyage: `voyage-4-lite` (1024-d, l2), `--source shadow`, space
  `voyage-4-lite-query-document-l2-1024-v1`. Query vectors came from a batched
  cache (1 API request), so the evaluation itself made **no** API calls.
- **Scope correction (fairness):** the first Voyage pass ran over the whole shadow
  table (24 chunks / 10 docs), while the BGE baseline pool is only the embedded
  chunks (20 chunks / 6 docs). The shadow table contained 4 extra docs
  (2x escalation-policy, 2x failure-case) that are not in the baseline pool, which
  depressed Voyage precision and added distractors. Both spaces were then rerun
  restricted to the same 6 evaluation documents (`--documents <6 ids>`). The
  scoped runs are the comparison of record; the unscoped Voyage run is kept for
  transparency. No metric definitions or labels were changed.

## Overall metrics (scoped, apples-to-apples)

| Metric | BGE (384-d) | Voyage (1024-d) | Delta |
|---|---|---|---|
| Recall@5 | 0.9281 | **0.9594** | +0.0313 |
| Precision@5 | 0.2875 | **0.3000** | +0.0125 |
| MRR | 0.9375 | **0.9688** | +0.0313 |
| nDCG@5 | 0.9035 | **0.9447** | +0.0412 |
| Hit@5 | 1.0000 | 1.0000 | 0 |

Both models retrieve a relevant chunk within the top 5 for every answerable
query (Hit@5 = 1.0). Voyage is modestly ahead on all graded/order metrics.

## Per-kind metrics

| Kind (n) | Metric | BGE | Voyage |
|---|---|---|---|
| answerable (10) | Recall / nDCG / MRR | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 |
| ambiguous (2) | Recall / nDCG / MRR | 0.675 / 0.6298 / 0.75 | 0.675 / 0.8133 / 1.00 |
| cross-chunk (2) | Recall / nDCG / MRR | 1.00 / 0.7916 / 0.75 | 1.00 / 0.9588 / 1.00 |
| cross-document (2) | Recall / nDCG / MRR | 0.75 / 0.8065 / 1.00 | 1.00 / 0.7853 / 0.75 |
| unanswerable (4) | passed | 0/4 | 0/4 |

Notable: Voyage recovers the cross-document miss (`shipping-and-warranty-cross-document`
now passes) and improves ordering on ambiguous and cross-chunk cases. The only
per-kind regression is nDCG/MRR on cross-document (Voyage finds every relevant
chunk but orders one of them lower), a small-sample effect.

## No-answer behaviour

No-answer is judged by **separability within each space** (absolute cosine values
are not comparable across embedding models).

| | BGE | Voyage |
|---|---|---|
| min answerable top-1 | 0.6241 | 0.2873 |
| max no-answer top-1 | 0.7337 | 0.5812 |
| margin | -0.1096 | -0.2939 |
| separated | false | false |

Neither model separates answerable from unanswerable queries on this fixture.
For the unanswerable queries both models return a plausible "about the company"
chunk (`company-info.*`) at a similarity that overlaps the answerable cluster, so
no fixed cosine threshold works. This is a property of the dataset and the
bi-encoder, not something the migration fixes.

## Failing-case analysis (scoped)

Seven cases fail under BGE, six under Voyage. Nothing in the dataset or metric
definitions was adjusted to improve these.

- `contact-support-ambiguous` (both fail; recall 0.75). Expected
  `warranty-policy.2`, `company-info.2`, `return-policy.4`, `return-policy.5`.
  Both miss `return-policy.4`; both find 3/4. Voyage ranks `company-info.2` first
  (MRR 1.0, nDCG 0.80) vs BGE ranking it third (MRR 0.5, nDCG 0.65). Failure is
  the strict `min-recall = 1` rule, not a ranking collapse.
- `fees-ambiguous` (both fail; recall 0.6). Expected
  `return-policy.3`, `return-policy.4`, `shipping-policy.1`, `shipping-policy.3`,
  `pricing.2`. Both find 3/5 (`pricing.2`, `shipping-policy.1`, `return-policy.3`)
  and both miss `shipping-policy.3` and `return-policy.4`. Same recall, better
  ordering for Voyage (nDCG 0.83 vs 0.61).
- `unanswerable-ceo-colour`, `unanswerable-ceo-name`,
  `unanswerable-employee-count`, `unanswerable-support-phone` (both fail). These
  are true no-answer queries; both models return `company-info` chunks (the
  fixture simply has no CEO/headcount chunk). See separability above.

Voyage additionally resolves `shipping-and-warranty-cross-document`, which BGE
misses (BGE recall 0.75, Voyage recall 1.0).

## Verdict (and limits)

On this small, synthetic 6-document fixture (`voyage-4-lite`), Voyage 1024-d
retrieval is equal or modestly better than the baked local BGE model on
recall/precision/MRR/nDCG and ties on Hit@5, with no regression that is not a
small-sample ordering wobble. **This is not enough evidence to claim Voyage is
broadly superior.** The fixture has 6 documents and 20 queries; no-answer
separability is unresolved for both; and the scoping confound had to be corrected
before the numbers were interpretable. A larger, more diverse corpus is required
before a production decision.

## Evidence files

- `reports/retrieval-eval/bge-baseline.json` / `bge-baseline-scoped.json`
- `reports/retrieval-eval/voyage.json` (unscoped, pre-fairness-fix) /
  `voyage-scoped.json` (comparison of record)
- API usage: migration 2 requests (pricing 150 + security 123 = 273 tokens);
  query cache 1 request. No API calls during evaluation (20 cached query vectors).
