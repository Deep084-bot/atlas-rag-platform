# OCR Operational Resilience Review — Final Pre-Implementation Audit

## 1. Railway Restart During OCR

### What happens if the Node process dies mid-OCR?

**Status in DB**: Document is `status='ocr'`, `progress=45`, `processing_started_at` set.

**In-memory state lost**:
- tesseract.js worker (pages completed but not committed)
- OCR queue lock
- Any partial OCR text not yet flushed to DB

**Downstream state**: Chunking and embedding never ran. No orphan chunks or embeddings exist. The document's `extracted_text` may be empty (if the orchestrator planned to write OCR text all at once) or partially written (if per-page flushing was implemented — but per-page flushing is NOT part of the design; text is written to DB once after all pages complete).

### Recovery

On restart, the in-memory queue is empty. The document stays in `status='ocr'`. Because `processDocument`'s status guard will check `['extracting', 'ocr', 'chunking', 'embedding']` and return early, the document is **never reprocessed**.

### Verdict

Without intervention, documents become permanently stuck in `status='ocr'` after a process crash.

**Severity: High** — requires startup reconciliation to resolve.

---

## 2. Documents Stuck in status='ocr'

### Can a document become permanently stuck?

**Yes**, in three scenarios:

| Scenario | Mechanism | Stuck? |
|----------|-----------|--------|
| Process crash mid-OCR | Status guard returns early on restart | Yes — permanently |
| OCR job hangs (infinite loop) | No heartbeat/deadline in queue | Yes — until Railway kills the container (hours) |
| Tesseract worker deadlock | Worker hangs on a page | Yes — mitigated by 15s/page timeout + 300s total timeout, but if timeout fails to cancel, still stuck |

### What does the user see?

The frontend polls every 2s for up to 10 minutes (`POLLING_TIMEOUT_MS = 600000`). After 10 minutes:
- Polling stops
- Document shows as "Processing..." forever (or "Reading scanned text..." with the OCR label)
- No error message
- No retry mechanism

### What existing mitigation exists?

None. The status guard explicitly skips processing states.

### Verdict

Stuck documents are a real production risk. The existing architecture has no recovery path.

**Severity: High** — requires startup reconciliation.

---

## 3. Queue Recovery After Process Crash

### Queue State on Crash

The queue uses in-process variables (`lockAcquired`, `queue[]`). On process death:

| Data | Persisted? | Recovery |
|------|-----------|----------|
| Queue lock state | ❌ In-memory | Lost — lock auto-releases on death ✅ |
| Queued but unstarted jobs | ❌ In-memory | Lost — documents stay in previous status ❌ |
| Running job's partial progress | ❌ In-memory | Lost — document stays in `ocr` status ❌ |

### Can queued-but-not-started jobs be recovered?

No. If the process crashes after `startDocumentIngestion` enqueues a job but before it starts OCR:
- The in-memory queue entry is lost
- The document is still in `'extracting'` status (if `extractTextFromUpload` returned text and the orchestrator was about to check the threshold)
- OR the document is still in `'uploaded'` status (if the crash happened before `processDocument` ran)

Wait — let me trace more carefully. `startDocumentIngestion` calls `processDocument` immediately. There's no queueing at this level. The queue is only for the OCR *portion* within `processDocument`. So:

1. `processDocument` starts → status becomes `'extracting'`
2. `extractTextFromUpload` runs → returns empty text → triggers OCR path
3. OCR queue acquire → waits/begins OCR
4. If crash happens between 2 and 3, status is `'extracting'`
5. If crash happens during 3, status is `'extracting'` (before OCR status update) OR `'ocr'` (after OCR status update)

So recovery is: startup reconciliation catches any document in `'extracting'` or `'ocr'` that's been there too long.

### Verdict

Queue recovery is handled by startup reconciliation if it covers both `'extracting'` and `'ocr'` statuses.

**Severity: Medium** — fully covered by startup reconciliation of processing states.

---

## 4. Maximum OCR File Size Limits

### Current limits
- Multer: 25MB (all uploads)
- MAX_OCR_PAGES: 10

### Does the 25MB upload limit adequately protect the OCR pipeline?

**Not entirely.** A 3-page scanned PDF at 25MB contains very high-resolution images. When pdfjs-dist renders a single page at scale 2.0, the raw RGBA buffer for a letter-size page is:
- Default viewport (72 DPI): 612 × 792 px → 1.9MB per page
- Scale 2.0 (144 DPI): 1224 × 1584 px → 7.6MB per page
- Scale 3.0 (216 DPI, if user cranks it up): 1836 × 2376 px → 17MB per page

At 7.6MB per page with sequential processing and cleanup, this is fine. **But**: a 25MB PDF could contain a single page at ultra-high resolution (e.g., a large architectural drawing at 600 DPI = 5100 × 6600 = 134MB of raw pixel data per page). This would OOM the process.

### Recommended additional safeguard

Cap rendered page dimensions, not file size:

```js
const viewport = page.getViewport({ scale: 1.5 });
// Clamp to prevent OOM from ultra-high-res pages
const MAX_RENDER_DIM = 2560;
const clampedWidth = Math.min(viewport.width, MAX_RENDER_DIM);
const clampedHeight = Math.min(viewport.height, MAX_RENDER_DIM);
// Use a custom viewport or render at clamped dimensions
```

At 2560px max dimension, worst-case RGBA buffer = 2560 × 2560 × 4 = 26MB. Acceptable.

### OCR-specific file size limit?

**Recommendation**: Add `MAX_OCR_FILE_SIZE_MB = 15` (env-configurable). Rationale:
- A scanned PDF >15MB likely has very high-res images that could cause memory pressure during pdfjs-dist parsing (before rendering)
- This is in ADDITION to the existing 25MB upload limit — regular (non-OCR) PDFs can still be up to 25MB
- Configured via env var, default 15MB

```js
const MAX_OCR_FILE_SIZE = (parseInt(process.env.MAX_OCR_FILE_SIZE_MB, 10) || 15) * 1024 * 1024;

if (document.fileSizeBytes > MAX_OCR_FILE_SIZE) {
    throw new Error(`File too large for OCR. Maximum file size is ${MAX_OCR_FILE_SIZE / 1024 / 1024} MB for scanned PDFs.`);
}
```

### Verdict

Add `MAX_OCR_FILE_SIZE_MB = 15` env var and a render dimension cap (2560px max). Without these, an ultra-high-res single-page scanned PDF can OOM the process.

**Severity: Medium** — low probability but high impact if hit.

---

## 5. OCR Retry Behavior

### Can failed OCR jobs be retried safely?

**Yes**, and the mechanism already exists implicitly:

1. User deletes the failed document (DELETE `/api/documents/:id`)
2. User re-uploads the same file
3. New ingestion begins fresh

This is safe because:
- OCR is stateless — it reads the file from disk and produces text
- No chunks or embeddings exist for a failed document (the pipeline never reached chunking)
- The `storagePath` file is deleted on document delete

### Should a "Retry" button be added?

**Not for v1.** Delete + re-upload is sufficient for the low expected frequency of OCR failures. A retry button adds complexity:
- Must reset status from `'failed'` → `'uploaded'`
- Must clear `failure_reason` and `failed_at`
- Must clear any partial chunks (if failure happened during chunking after OCR)
- Must re-trigger ingestion

### What about retrying a specific page?

No. Per-page retry adds significant complexity for marginal value. If a single page fails OCR, the page gets empty text, and the document completes with partial content. The user can re-upload if they need better results.

### Is there a risk of infinite retry loops?

Not with delete + re-upload (explicit user action). If a retry button were added, we'd need a retry count limit.

### Verdict

Retry is safe but requires status reset. Delete + re-upload is sufficient for v1. No retry button needed.

**Severity: Low** — safe, no action needed.

---

## 6. Tesseract Language Strategy

### Is English-only sufficient for v1?

**Yes.** Analysis of the target document types:

| Document type | Language | Tesseract accuracy (eng) |
|--------------|----------|------------------------|
| Resumes (English) | en | >95% |
| Notes (English) | en | >95% |
| Contracts | en | >95% |
| Screenshots of English text | en | >90% |
| Scanned forms | en | >90% |
| Handwritten notes | en | ~50-70% (Tesseract has poor handwriting recognition regardless of language) |
| Non-English documents | mixed | Poor — but out of scope for v1 |

### Language data size

| Language | Data size |
|----------|-----------|
| `eng` only | 8MB |
| `eng + fra` | 21MB |
| `eng + deu` | 22MB |
| `eng + spa` | 21MB |
| `eng + all` | ~200MB |

For Railway's 512MB memory limit, disk space for language data is not a concern (500MB available). But each active language model adds ~50MB to the worker's memory.

### Multi-language detection

Tesseract supports detecting the document language automatically, but this requires loading multiple language models simultaneously — both memory and time prohibitive.

### Recommendation for v1

Hardcode `'eng'`. Add language configuration in a follow-up:
- `OCR_LANGUAGE=eng` env var
- Per-document language override (for future UI)
- Only load additional language data on demand

### Verdict

English-only is correct for v1. The single language model fits within memory, caches to ~8MB, and covers the target document types.

**Severity: Low** — correct for v1.

---

## 7. Startup Reconciliation Logic

### Design

On application startup, after the database connection is verified, run a reconciliation query to fail any documents stuck in processing states beyond a timeout threshold.

### Target states

- `'extracting'` — pdf-parse running (should complete in seconds)
- `'ocr'` — OCR running (should complete in <2min for 10 pages)
- `'chunking'` — chunking (should complete in <1s)
- `'embedding'` — embedding (should complete in <30s for typical doc)

### Timeout threshold

**30 minutes** (`RECONCILE_STUCK_TIMEOUT_MINUTES = 30`).

Rationale:
- Longest normal operation: OCR (10 pages × 7s = 70s, with queue wait up to 5×50s = 250s)
- Total max normal processing: ~5 minutes
- 30 minutes provides 6x safety margin
- Short enough that users aren't waiting unreasonably

### SQL

```sql
UPDATE documents
SET
  status = 'failed',
  failure_reason = 'Processing was interrupted. Please re-upload the document.',
  failed_at = NOW(),
  updated_at = NOW()
WHERE status IN ('extracting', 'ocr', 'chunking', 'embedding')
  AND (
    processing_started_at IS NULL
    OR processing_started_at < NOW() - $1::interval
  )
RETURNING id, status
```

Where `$1` is `RECONCILE_STUCK_TIMEOUT_MINUTES` minutes.

### Edge cases

| Case | Handled? |
|------|----------|
| Document in `'extracting'` with `processing_started_at IS NULL` | ✅ — covered by `OR processing_started_at IS NULL` |
| Document entered `'ocr'` 5 seconds ago | ✅ — `processing_started_at` is recent, not affected |
| Document entered `'extracting'` 31 minutes ago | ✅ — marked failed |
| Document entered `'ocr'` 31 minutes ago, OCR actually still running (rare) | ⚠️ — marked failed. This is a false positive, but OCR taking >30min for 10 pages (~300s) means something is wrong anyway |
| Document in `'uploaded'` waiting for ingestion to start | ✅ — `'uploaded'` is not in the target set |
| Document in `'ready'` | ✅ — not in target set |
| Document already in `'failed'` | ✅ — not in target set |

### Where to place it

In `server/index.js`, after `app.listen()` — run it once asynchronously:

```js
app.listen(port, async () => {
  console.log(`Atlas API listening on http://localhost:${port}`);
  reconcileStuckDocuments().catch(err => {
    console.error('Startup reconciliation failed:', err.message);
  });
});
```

Or in `server/app.js` after dependencies are wired but before `export default app`. The `server/index.js` approach is cleaner — the reconciliation is a startup concern, not an app config concern.

### Should periodic reconciliation be added?

The startup reconciliation handles the common crash-reboot cycle. For v1, this is sufficient. A periodic 5-minute cron-style reconciliation can be added in a later iteration if stuck documents become a frequent support issue.

### Reconciliation log

Log the count and IDs of reconciled documents for observability:
```
Reconciled 2 stuck document(s): abc-123 (was ocr), def-456 (was extracting)
```

### Verdict

Startup reconciliation is the single most important operational safeguard for OCR. Without it, process crashes permanently orphan documents in processing states. With it, recovery is automatic on next deploy or restart.

**Severity: High** — required before OCR ships.

---

## Summary Table

| # | Concern | Severity | Mitigation | Required Before Ship? |
|---|---------|----------|------------|----------------------|
| 1 | Process crash leaves doc in `'ocr'` forever | **High** | Startup reconciliation | ✅ Yes |
| 2 | No recovery path for stuck processing states | **High** | Startup reconciliation | ✅ Yes |
| 3 | Queue lock not released on crash | **High** | In-memory lock dies with process — auto-resolved ✅ | No action needed |
| 4 | Ultra-high-res page renders OOM | **Medium** | Render dimension cap (2560px) + `MAX_OCR_FILE_SIZE_MB=15` | ✅ Yes |
| 5 | Queue depth unbounded | **Medium** | `MAX_QUEUE_DEPTH=5` (from prior review) | ✅ Yes |
| 6 | tesseract language data cold-start latency | **Low** | Pre-seed `TESSDATA_PREFIX` to project-local path | Recommended |
| 7 | No retry UI for failed OCR | **Low** | Delete + re-upload is sufficient for v1 | No |
| 8 | English-only OCR misses non-English docs | **Low** | Acceptable for v1; language config in follow-up | No |
| 9 | Queue job waiting timeout | **Medium** | Add timeout to queue acquisition (300s) | ✅ Yes |

## Startup Reconciliation — Final Specification

Location: `server/documents/reconcileStuckDocuments.js` (new file)

```js
export async function reconcileStuckDocuments(pool, timeoutMinutes = 30) {
  const result = await pool.query(
    `UPDATE documents
     SET status = 'failed',
         failure_reason = 'Processing was interrupted. Please re-upload the document.',
         failed_at = NOW(),
         updated_at = NOW()
     WHERE status IN ('extracting', 'ocr', 'chunking', 'embedding')
       AND (
         processing_started_at IS NULL
         OR processing_started_at < NOW() - ($1 || '0')::integer * INTERVAL '1 minute'
       )
     RETURNING id, status`,
    [timeoutMinutes]
  );
  if (result.rowCount > 0) {
    console.log(`[reconcile] Marked ${result.rowCount} stuck document(s) as failed:`,
      result.rows.map(r => `${r.id} (was ${r.status})`).join(', '));
  }
  return result.rowCount;
}
```

Called in `server/index.js`:
```js
import { reconcileStuckDocuments } from './documents/reconcileStuckDocuments.js';
import { getPool } from './db.js';

app.listen(port, async () => {
  console.log(`Atlas API listening on http://localhost:${port}`);
  try {
    const pool = getPool();
    if (pool) await reconcileStuckDocuments(pool);
  } catch (err) {
    console.error('[reconcile] Failed:', err.message);
  }
});
```

## OCR File Size Guard — Final Specification

In the OCR fallback branch of `documentOrchestrator.js`, before acquiring the OCR queue:

```js
const MAX_OCR_FILE_SIZE = (parseInt(process.env.MAX_OCR_FILE_SIZE_MB, 10) || 15) * 1024 * 1024;
if (document.fileSizeBytes > MAX_OCR_FILE_SIZE) {
  throw new Error(`This scanned PDF is too large for OCR (max ${MAX_OCR_FILE_SIZE / 1024 / 1024} MB).`);
}
```

And in `server/ocr/pdfRenderer.js`, when rendering a page:

```js
const MAX_RENDER_DIM = 2560;
const scale = Math.min(1.5, MAX_RENDER_DIM / Math.max(viewport.width, viewport.height));
const clampedViewport = page.getViewport({ scale });
```

## Final Verdict

**The OCR architecture is production-ready provided these operational safeguards are implemented:**

1. Startup reconciliation for stuck processing states (required — High severity)
2. Render dimension cap + OCR-specific file size limit (required — Medium severity)
3. Queue timeout + max queue depth (required — Medium severity, from prior review)
4. Pre-seeded TESSDATA_PREFIX (recommended — Low severity)

Without items 1-3, the system is vulnerable to permanently stuck documents and OOM crashes. With all items, the OCR pipeline is resilient to process death, memory pressure, and queue overload.
