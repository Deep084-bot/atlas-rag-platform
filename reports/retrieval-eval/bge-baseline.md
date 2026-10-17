# Retrieval evaluation — BGE baseline (Stage 2)

Machine-readable: `reports/retrieval-eval/bge-baseline.json`

## Configuration (identical for the Voyage run)

| Setting | Value |
| --- | --- |
| Target DB | `localhost:5432/atlas_rag_staging` (disposable) |
| Source | `baseline` (`chunks` table, BGE space) |
| Space | `bge-small-en-v1.5-mean-l2-int8-v1` (384-d, L2) |
| Provider | `local` (pinned ONNX BGE, no network) |
| Cases | `scripts/dev/fixtures/retrieval-eval-cases.resolved.json` (20) |
| Top-k | 5 |
| Min-recall (pass rule) | 1.0 (every graded relevant chunk in top-5) |
| Corpus in index | 20 embedded chunks across 6 docs (a1–d4 reused, e5 pricing + f6 security seeded) |

## Headline metrics (macro over 16 answerable cases)

| Metric | BGE baseline |
| --- | --- |
| Recall@5 | 0.9281 |
| Precision@5 | 0.2875 |
| MRR | 0.9375 |
| nDCG@5 | 0.9035 |
| Hit rate@5 | 1.0000 |

## Per kind

| Kind | Cases | Passed | Recall@5 | nDCG@5 | MRR |
| --- | --- | --- | --- | --- | --- |
| answerable | 10 | 10 | 1.0000 | 1.0000 | 1.0000 |
| ambiguous | 2 | 0 | 0.6750 | 0.6298 | 0.7500 |
| cross-chunk | 2 | 2 | 1.0000 | 0.7916 | 0.7500 |
| cross-document | 2 | 1 | 0.7500 | 0.8065 | 1.0000 |
| unanswerable | 4 | 0 | – | – | – |

## No-answer behaviour (separability within the BGE space)

| Signal | Value |
| --- | --- |
| min answerable top-1 | 0.6241 |
| max no-answer top-1 | 0.7337 |
| margin (min ans − max no-ans) | −0.1096 |
| separated | false |

BGE gives unanswerable queries a **higher** top-1 similarity than the weakest
answerable query, so no absolute cutoff can separate them (`separated: false`).
This is the main weakness the baseline exposes.

## Failures under the strict pass rule

`contact-support-ambiguous`, `fees-ambiguous`, `shipping-and-warranty-cross-document`,
and all four `unanswerable-*` cases.

These fail because (a) ambiguous/cross-document cases have multiple graded chunks
that cannot all fit in top-5, and (b) no-answer cases are all marked failed when
the space is not separable. They are expected and are the discriminating signal
for Stage 3, not defects in the run.

## Notes

- `allSingleSpace: true` — every retrieved row was BGE; no Voyage rows leaked in.
- The 4 pre-existing unembedded docs (`escalation-policy`, `failure-case`) are not
  in the retrieval index and do not affect results.
- Metrics and labels are frozen; the Voyage run must reuse this exact case file,
  top-k, and provider config so the comparison differs only by embedding space.
