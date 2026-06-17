# OCR Engineering Review — Final Pre-Implementation Audit

## Summary of Findings

| Severity | Count | Items |
|----------|-------|-------|
| **Critical** | 0 | — |
| **High** | 2 | Queue lock never released on crash; pdfjs-dist page/document objects not cleaned up = memory leak |
| **Medium** | 5 | processDocument status guard must include `'ocr'`; cold-start language download; unbounded queue depth; @napi-rs/canvas integration complexity; sharp can be dropped |
| **Low** | 3 | 50-char false-positive edge case; no token gap handling for OCR noise; no per-page error isolation in render step |

---

## 1. OCR Architecture Audit

### Decision Point Location

The OCR fallback branch must live inside `processDocument()` in `documentOrchestrator.js`, between the `extracting` status update and the `chunking` status update. This is correct.

**Current code in `processDocument`** (`documentOrchestrator.js:39`):
```js
if (['extracting', 'chunking', 'embedding'].includes(document.status)) {
    return document;
}
```

**HIGH**: This guard does NOT include `'ocr'`. If `processDocument` is somehow called while OCR is in-flight (e.g., race condition, double-invocation), a second OCR job starts. Must add `'ocr'`:
```js
if (['extracting', 'ocr', 'chunking', 'embedding'].includes(document.status)) {
    return document;
}
```

### Text Extraction Behavior

**`extractText.js:30-33`**: Currently throws on empty PDF text:
```js
if (extractedText.length === 0) {
    throw new UploadValidationError('This PDF contains no extractable text...');
}
```

For OCR support, this must change. Instead of throwing, `extractTextFromUpload` should return `{fileType, extractedText: ''}` when text is empty. The OCR decision then lives in `documentOrchestrator.js`, not in `extractText.js`. This separation of concerns is correct per the design.

### What Remains Unchanged

All downstream stages are unaffected — the orchestrator already writes the final `extractedText` before chunking:
- `updateDocumentText` writes the extracted or OCR'd text
- `chunkService.chunkDocument` reads `extractedText` from DB — no change needed
- `embeddingService.embedDocument` reads chunks from DB — no change needed
- All retrieval/search/chat layers are downstream of embeddings — no change needed

**Verdict**: Architecture is sound. The insertion point and isolation boundary are correct.

---

## 2. Railway Deployment Risks

### pdfjs-dist Size

pdfjs-dist v4 is ~15MB installed (includes worker WASM, cmaps, etc.). Railway hobby has 500MB disk — fine.

### @napi-rs/canvas Binary

`@napi-rs/canvas` provides prebuilt N-API binaries for `linux-x64-gnu`. Railway uses Ubuntu (glibc), so the `gnu` variant is correct. The binary is loaded at runtime (not build time), so Railway's build process won't need special tooling.

**Risk**: If the N-API binary fails to load (ABI mismatch, wrong arch), the entire OCR pipeline fails at the canvas creation step. Mitigation: Catch the import error and fail gracefully with a clear message.

### tesseract.js Language Data

tesseract.js v7 downloads `eng.traineddata` (~8MB) on first `createWorker('eng')` call. This is cached to `~/.tesseract.js-data` which persists per-deployment on Railway but is lost on redeploy.

**MEDIUM**: Every cold deployment incurs an ~8MB download + ~3-5s latency. Consider pre-seeding the language data:
```js
process.env.TESSDATA_PREFIX = path.resolve('data/tessdata');
```
Or download during a build step and include in the deployment artifact.

### Request Timeout on Railway Hobby (30s)

OCR for a 10-page PDF at ~5s/page = ~50s. This exceeds Railway Hobby's 30s request timeout.

**However**: `processDocument` is called via `startDocumentIngestion` which is fire-and-forget (`void this.processDocument(...)`). The HTTP response to the upload request is sent BEFORE ingestion begins. So the 30s request timeout does NOT apply to OCR.

The concern is if Railway terminates the Node.js process itself after some period of inactivity on Hobby tier. Railway's free/Hobby tier can sleep after ~15 minutes of inactivity. If OCR runs for 50s but the process is kept alive by the OCR work, Railway shouldn't sleep. Low risk.

**Verdict**: Railway risks are manageable. No critical blockers. Pre-seeding tesseract language data is recommended but not required.

---

## 3. Memory Risks

### pdfjs-dist Page Cleanup

**HIGH**: pdfjs-dist is designed for browser use where document/page objects are garbage-collected when pages navigate away. In Node.js with long-lived processes, each `PDFDocumentProxy` holds the parsed PDF structure (~50-100MB for a 10-page scanned PDF). Each `PDFPageProxy` holds rendered bitmap data.

Without explicit cleanup, memory accumulates across documents. For a server processing multiple OCR jobs sequentially, this is a leak.

**Required mitigations**:

```js
// After each page
page.cleanup(); // Releases rendered bitmap data

// After all pages (in finally block)
await pdfDocument.destroy(); // Releases document structure
```

Both calls must be in `finally` blocks to guarantee cleanup even on errors.

### tesseract.js Worker Memory

Each worker is a WebAssembly instance holding the language model (~50-80MB). Workers persist across calls. The design creates ONE worker per OCR job and terminates it after all pages are processed. This is correct.

**Risk**: If `worker.terminate()` is not called (uncaught error), the worker stays in memory. Mitigation: wrap worker lifecycle in try/finally.

### Sharp Memory

**Correction**: `sharp` does NOT need to be part of the OCR pipeline. `@napi-rs/canvas`'s `canvas.toBuffer('image/png')` produces a PNG buffer directly. Removing `sharp` reduces peak memory by ~30-50MB and eliminates one native dependency.

### Peak Memory Calculation (Revised, no sharp)

| Component | Memory |
|-----------|--------|
| Node.js runtime | ~50MB |
| pdfjs-dist document (10-page PDF) | ~50MB |
| pdfjs-dist page render (one page) | ~50-100MB |
| @napi-rs/canvas canvas + PNG buffer | ~10-30MB |
| tesseract.js worker | ~100-150MB |
| File buffer (25MB max) | ~25MB |
| **Peak total** | **~285-405MB** |

This fits within Railway's 512MB but is close. The sequential queue (one OCR at a time) is essential — two concurrent jobs would exceed 512MB.

**Verdict**: Memory risks are manageable with proper cleanup and the sequential queue. Without the queue, this design fails on Railway.

---

## 4. Failure Handling

### Queue Lock Never Released on Crash

**HIGH**: The simple in-process queue uses a lock flag. If the OCR job crashes with an unhandled exception BETWEEN `acquireOcrLock()` and `releaseOcrLock()`, the lock is never released. This permanently stalls the queue — all subsequent OCR jobs wait forever.

```js
// WRONG — unsafe
await acquireOcrLock();
const text = await doOcr(); // If this throws, lock is never released
releaseOcrLock();
```

**Required**: The lock release MUST be in a `finally` block:
```js
await acquireOcrLock();
try {
    const text = await doOcr();
} finally {
    releaseOcrLock();
}
```

Moreover, the `acquireOcrLock()` itself should handle edge cases:
- What if `acquireOcrLock()` is called and the promise never resolves because the running job crashed without releasing?
- **Mitigation**: Add a timeout to queued lock acquisitions (e.g., 300s wait max)

### Total OCR Failure

If zero pages OCR successfully, the document should go to `failed` with a clear message. This is handled by the existing error path in `processDocument`'s catch block.

### Partial OCR Failure

If some pages OCR successfully and others fail, the design says to continue with what we have. This is correct — partial text is better than no text.

**Missing detail**: When continuing with partial text, ensure the error logging does not mark the document as `failed`. The `processDocument` catch block should NOT fire for per-page errors — they must be caught and handled locally within the OCR loop.

### Timeout Safeguards

- 15s per-page timeout: Must pass `AbortSignal` to both `page.render()` and `worker.recognize()`. pdfjs-dist v4 supports `AbortSignal` in `page.render()`. tesseract.js v7 supports `AbortSignal` in `worker.recognize()`.
- 300s total timeout: Should use `AbortController` wrapping the entire OCR loop.

**Check**: Both libraries accept `signal` parameter. If not, we may need to use `Promise.race` with a timeout as fallback.

### Queue Depth Unbounded

**MEDIUM**: The queue has no max depth. If a user uploads 20 scanned PDFs (or 20 users each upload one), all queue up. At ~50s per document (10 pages × 5s), 20 documents = 1000s = ~17 minutes of sequential processing.

**Mitigation**: Set `MAX_QUEUE_DEPTH = 5`. If exceeded, reject the OCR job — the document goes to `failed` with "Server is busy processing other documents. Please try again." Configured via env var for flexibility.

---

## 5. Queue Design

### Correctness

The in-process queue pattern:
```js
let lockAcquired = false;
const queue = [];

async function acquire(timeoutMs = 300000) { ... }
function release() { ... }
```

This is sufficient for a single-process deployment. No Redis, no BullMQ needed. Correct.

**Critical detail**: The `acquire` function must handle the case where the lock holder crashes without releasing. A timeout-based acquisition handles this:
```js
async function acquire(timeoutMs = 300000) {
    if (!lockAcquired) {
        lockAcquired = true;
        return;
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('OCR queue timeout')), timeoutMs);
        queue.push(() => { clearTimeout(timer); resolve(); });
    });
}
```

### Queue Granularity

Should the queue lock cover just the OCR portion, or the entire `processDocument`?

**Recommendation**: Lock only the OCR portion (pdf rendering + tesseract). The extracting, chunking, and embedding stages are CPU-light and can run concurrently. This maximizes throughput:
```js
// extracting stage (pdf-parse) — concurrent
const extracted = await extractTextFromUpload(...);

// OCR fallback — locked
if (shouldOcr) {
    await ocrLock.acquire();
    try {
        const ocrText = await ocrService.ocrPdf(buffer, MAX_OCR_PAGES);
        extractedData = ocrText;
    } finally {
        ocrLock.release();
    }
}

// chunking + embedding — concurrent
```

### Queue Scope

**Low**: The queue should be module-scoped (or in a singleton service) so all instances of the orchestrator share the same lock. In a multi-process deployment (e.g., multiple Railway instances), this queue doesn't synchronize across processes — but Atlas runs as a single process on Railway, so this is fine.

**Verdict**: Queue design is correct with the try/finally and timeout additions. Single-process scope is acceptable for Railway.

---

## 6. PDF Rendering Approach

### Revised Library Stack

The original design specified `pdfjs-dist` + `sharp`. After analysis, **drop `sharp`** from the OCR pipeline.

**Revised stack**: `pdfjs-dist` + `@napi-rs/canvas` + `tesseract.js`

**Reason**: `@napi-rs/canvas` provides `canvas.toBuffer('image/png')` which produces a PNG buffer directly — no need for a separate image encoding library.

### pdfjs-dist Integration

pdfjs-dist v4 requires a `CanvasFactory` implementation for Node.js rendering. The default `NodeCanvasFactory` requires the `canvas` npm package (node-canvas, which needs system deps).

Implement a custom `CanvasFactory` using `@napi-rs/canvas`:

```js
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist';

class NapiCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(ctx) { /* no-op */ }
  destroy(ctx) { /* no-op */ }
}
```

**Compatibility check**: @napi-rs/canvas implements the standard Canvas 2D API. pdfjs-dist's renderer calls `drawImage`, `getImageData`, `putImageData`, transform methods, and path operations — all part of the standard Canvas API. Compatible.

### Rendering Loop

```js
const doc = await pdfjsLib.getDocument({
    data: pdfBuffer,
    canvasFactory: new NapiCanvasFactory()
}).promise;

const totalPages = Math.min(doc.numPages, MAX_OCR_PAGES);

try {
    for (let i = 1; i <= totalPages; i++) {
        const page = await doc.getPage(i);
        try {
            const viewport = page.getViewport({ scale: 2.0 }); // 2x for OCR quality
            const factory = new NapiCanvasFactory();
            const { canvas, context } = factory.create(viewport.width, viewport.height);
            
            await page.render({ canvasContext: context, viewport }).promise;
            const pngBuffer = canvas.toBuffer('image/png');
            
            // OCR this page
            const { data } = await worker.recognize(pngBuffer);
            allText += data.text + '\n';
        } finally {
            page.cleanup();
        }
    }
} finally {
    await doc.destroy();
}
```

### @napi-rs/canvas Binary Support

| Platform | Prebuilt |
|----------|----------|
| darwin-arm64 (dev) | ✅ `@napi-rs/canvas-darwin-arm64` |
| linux-x64-gnu (Railway) | ✅ `@napi-rs/canvas-linux-x64-gnu` |

Both have prebuilt binaries. No compilation needed.

### DPI / Scale Recommendation

`page.getViewport({ scale: 2.0 })` = ~144 DPI (from default 72 DPI). This produces a ~1654×2339 image for A4 at 2x. Tesseract achieves good accuracy at ≥300 DPI, but for printed/scanned text, 144 DPI is adequate. Higher scales increase rendering time and memory linearly.

**Recommendation**: Start with `scale: 2.0`. If accuracy is poor, increase to `3.0` (216 DPI). For v1, 2.0 is sufficient.

**Verdict**: The pdfjs-dist + @napi-rs/canvas pairing is correct and better than pdfjs-dist + sharp. The integration approach is sound.

---

## 7. Tesseract Integration

### Worker Lifecycle

```js
import Tesseract from 'tesseract.js';

async function ocrPages(pngBuffers, signal) {
    const worker = await Tesseract.createWorker('eng');
    try {
        const results = [];
        for (const buffer of pngBuffers) {
            const { data } = await worker.recognize(buffer, { signal });
            results.push(data.text);
        }
        return results;
    } finally {
        await worker.terminate();
    }
}
```

One worker per document, reused across pages. Worker terminated after all pages are processed. This is correct.

### Language Data Path

tesseract.js v7 caches language data to:
1. `TESSDATA_PREFIX` env var (if set)
2. `~/.tesseract.js-data` (default)

**Recommendation**: Set `TESSDATA_PREFIX` at app startup:
```js
process.env.TESSDATA_PREFIX = path.join(process.cwd(), '.tessdata');
```

This makes the cache part of the project directory, which persists across Railway restarts within a single deployment. The directory may be cleared on redeploy, but that's acceptable.

### First-Run Latency

On first OCR call, `createWorker('eng')` downloads `eng.traineddata` (~8MB). This adds ~3-5s to the first OCR job. Subsequent jobs use the cached data.

**Mitigation**: Consider pre-downloading during build or on first request. For v1, accept the cold-start penalty.

### Error Handling Per Page

Each `worker.recognize()` call should be individually wrapped:
```js
for (const buffer of pngBuffers) {
    try {
        const { data } = await worker.recognize(buffer, { signal });
        results.push(data.text);
    } catch (err) {
        console.error(`Page ${i} OCR failed:`, err.message);
        results.push(''); // Empty text for failed page, continue with next
    }
}
```

This prevents a single bad page from failing the entire document.

**Verdict**: Tesseract integration is straightforward and well-supported in v7. Worker reuse is the correct performance pattern.

---

## 8. Database Migration Correctness

### Status Constraint Migration

**SQL**: `documents_status_check` is currently:
```sql
CHECK (status IN ('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed'))
```

Migration to add `'ocr'`:
```sql
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'extracting', 'ocr', 'chunking', 'embedding', 'ready', 'failed'));
```

**Risk**: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` in separate statements. In the window between them, invalid statuses can be inserted. Mitigation: Use a single transaction:
```sql
BEGIN;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'extracting', 'ocr', 'chunking', 'embedding', 'ready', 'failed'));
COMMIT;
```

### Existing Data

All existing documents have statuses in the old allowed set. Adding `'ocr'` doesn't affect them. Any document that was in `'extracting'` state when this migration runs can transition to `'ocr'` after migration — same constraint applies to both old and new sets. **No data migration needed.**

### Progress Values

Existing progress pattern:
- `uploaded`: 10
- `extracting`: 30
- `chunking`: 60
- `embedding`: 90
- `ready`: 100

OCR progress slot: 45 (between extracting's 30 and chunking's 60). The existing progress constraint `CHECK (progress >= 0 AND progress <= 100)` accepts all values.

**Verdict**: Migration is correct. Add `BEGIN/COMMIT` for safety.

---

## 9. Frontend Status Handling

### POLLING_STATUSES

File: `web/src/hooks/useDocuments.js:5`
```js
const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'chunking', 'embedding']);
```

Must add `'ocr'`:
```js
const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'ocr', 'chunking', 'embedding']);
```

**Without this**: Documents stuck in `"OCR..."` status never update because the frontend stops polling.

### Status Label

File: `web/src/pages/WorkspacePage.jsx:44-54`
```js
function getDocumentStatusLabel(status) {
    if (status === 'ready') return 'Ready';
    if (status === 'failed') return 'Failed';
    return 'Processing'; // Fallthrough — 'ocr' gets 'Processing'
}
```

Current behavior: `'ocr'` falls through to `'Processing'`. This is acceptable but not ideal. Consider adding:
```js
if (status === 'ocr') return 'Reading scanned text...';
```

### Status Tone

File: `web/src/pages/WorkspacePage.jsx:32-42`
```js
function getDocumentStatusTone(status) {
    if (status === 'ready') return 'success';
    if (status === 'failed') return 'error';
    return 'loading'; // 'ocr' gets 'loading' — correct
}
```

`'ocr'` falls through to `'loading'` which shows the amber "Processing" pill. Correct — no change needed.

### Progress Bar

At progress 45, the bar shows at 45%. The CSS uses `Math.max(0, Math.min(100, Number(document.progress) || 0))` — handles all values correctly. No UI change needed.

### Edge Case: Document Stays in 'ocr' Forever

If the Node.js process crashes mid-OCR, the document stays in `'ocr'` status forever. The frontend polls every 2s for up to 10 minutes (`POLLING_TIMEOUT_MS = 600000`). After 10 minutes, polling stops and the document appears stuck.

**Mitigation**: Add `'ocr'` to the polling timeout logic is already handled — it's in `POLLING_STATUSES`, so polling continues. After 10 minutes, the user sees a stuck document. They can manually refresh. This is the same behavior as `'extracting'` today — not worse.

**Verdict**: Frontend changes are minimal and correct. The `POLLING_STATUSES` addition is the only critical change.

---

## Key Corrections to the Implementation Plan

### 1. Drop `sharp` from the OCR pipeline

Replace with `@napi-rs/canvas`. `@napi-rs/canvas` can produce PNG buffers directly via `canvas.toBuffer('image/png')`. This eliminates:
- One native dependency (sharp's libvips)
- ~30-50MB of memory during OCR
- One npm package to install
- Potential build issues on Railway

### 2. Add `@napi-rs/canvas` dependency

```
npm install @napi-rs/canvas
```

This provides the Canvas implementation that pdfjs-dist needs, avoiding `node-canvas` entirely.

### 3. Ensure page/document cleanup

The rendering loop must call:
- `page.cleanup()` after each page (in `finally`)
- `doc.destroy()` after all pages (in `finally`)

Without this, memory grows linearly with each OCR'd document.

### 4. Queue lock with try/finally

The OCR queue must use try/finally for lock release. No exceptions.

### 5. Transactional DB migration

Wrap the constraint drop+add in `BEGIN/COMMIT`.

### 6. processDocument status guard

Add `'ocr'` to the early-return status array.

---

## Implementation Order (Revised)

1. `npm install pdfjs-dist @napi-rs/canvas` (no sharp)
2. `server/ocr/pdfRenderer.js` — pdfjs-dist + @napi-rs/canvas, page rendering, cleanup, AbortSignal
3. `server/ocr/ocrText.js` — tesseract.js worker lifecycle, per-page error isolation
4. `server/ocr/ocrService.js` — orchestrates render + OCR, page limit (10), timeouts, queue with try/finally
5. `database/migrations/20260617_add_ocr_status.sql` — transactional constraint update
6. `database/schema.sql` — include `'ocr'` in CHECK constraint
7. `server/documents/extractText.js` — return empty text instead of throwing for scanned PDFs
8. `server/documents/documentOrchestrator.js` — add OCR fallback branch, update status guard, wire queue
9. `server/app.js` — create OCR service, pass to orchestrator
10. `web/src/hooks/useDocuments.js` — add `'ocr'` to `POLLING_STATUSES`
11. `web/src/pages/WorkspacePage.jsx` — add label for `'ocr'` status
12. `npm run build` — verify

---

## Final Verdict

| Concern | Assessment |
|---------|-----------|
| Will this fail in production? | Not critically. The queue lock crash and memory leak are the highest risks — both are preventable with try/finally and cleanup calls. |
| Hidden memory leak risk? | **Yes** — pdfjs-dist page/document objects not cleaned up. Fixed with `page.cleanup()` + `doc.destroy()` in finally blocks. |
| Is sharp + pdfjs-dist correct? | **No** — sharp is unnecessary. Use `@napi-rs/canvas` instead. Fewer deps, no native build issues, direct PNG output. |
| Is the queue sufficient? | **Yes**, with two additions: (1) try/finally for lock release, (2) timeout on queue acquisition. |
| Would you change anything? | **Drop sharp, add @napi-rs/canvas, add page/document cleanup, add queue timeout, limit queue depth to 5, transactional migration.** |
