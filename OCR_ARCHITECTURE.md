# OCR Ingestion Architecture — Atlas v1.4 Design

## TASK 1 — Current Ingestion Audit

### Pipeline Diagram (Current)

```
POST /api/documents/upload
  ↓
validateDocumentUpload (mimeType / extension check)
  ↓
storageProvider.saveFile (disk)
  ↓
documentsRepository.insertDocument (status: "uploaded", progress: 10)
  ↓
documentOrchestrator.startDocumentIngestion  ← fire-and-forget
  ↓
processDocument:
  1. updateStatus("extracting", 30)
  2. readFile → extractTextFromUpload (pdf-parse)
  3. updateDocumentText
  4. updateStatus("chunking", 60)
  5. chunkService.chunkDocument
  6. updateStatus("embedding", 90)
  7. embeddingService.embedDocument
  8. markReady (100)
```

### Where OCR Should Enter

**Between step 2 and step 3** — inside `processDocument` in `documentOrchestrator.js`, after `extractTextFromUpload` returns but before text is persisted. The decision point: if extracted text is below a threshold, OCR the PDF pages and use the OCR result as the `extractedText`.

### Where OCR Should NOT Enter

- **Upload route** (`routes.js`): No change. The upload route persists the file and fires ingestion. It should not do OCR synchronously — that would block the HTTP response.
- **Chunk service** (`chunkService.js`): No change. Chunks operate on `extractedText` regardless of origin (pdf-parse vs OCR).
- **Embedding service** (`embeddingService.js`): No change. Embeds chunk content regardless of origin.
- **Search/retrieval pipeline**: No change. Retrieval queries the vector index on chunks — origin is invisible at that layer.

### Existing Stages That Remain Unchanged

| Stage | File | Change? |
|-------|------|---------|
| Upload + validation | `routes.js` | No |
| File persistence | `storage/local.js` | No |
| DB insert | `repository.js` | No |
| Chunking | `chunkService.js`, `chunkText.js` | No |
| Embedding | `embeddingService.js`, `HuggingFaceProvider.js` | No |
| Search/retrieval | `searchService.js`, `retrievalService.js` | No |
| Status polling | `useDocuments.js` (frontend) | Minor (add 'ocr' to POLLING_STATUSES) |
| Status display | `WorkspacePage.jsx` | Minor (add 'ocr' label) |
| Pipeline orchestration | `documentOrchestrator.js` | **Yes — insertion point** |
| Text extraction | `extractText.js` | **Yes — OCR fallback branch** |

---

## TASK 2 — OCR Trigger Strategy

### Recommended: Option B (Fallback)

**Attempt normal extraction first, fall back to OCR only when necessary.**

Rationale:
- Most PDFs have extractable text. OCR is 10-100x slower and produces noisier output.
- Running OCR unconditionally doubles ingestion time for normal PDFs.
- The 50-character threshold is a reliable heuristic: scanned PDFs yield 0-20 chars (typically just metadata), while text PDFs yield hundreds to thousands.

### Threshold Recommendation

**50 characters** of normalized text.

- `pdf-parse` on an empty/scanned PDF typically returns 0-20 characters (whitespace, metadata artifacts).
- A real text PDF will have at least one sentence's worth of text >> 50 chars.
- 50 chars is safely above noise floor but below any legitimate content.

### Behavior

```python
extracted = extractTextFromUpload(buffer)
if fileType == 'pdf' and len(extracted.extractedText) < 50:
    extracted = ocrPdf(buffer, maxPages=20)
```

No threshold needed for `.txt` files — they are always text.

### Edge Cases

- **Mixed PDF** (scanned images + text layer): `pdf-parse` extracts the text layer, which may be partial. If >50 chars, we use it. Acceptable — the text layer is authoritative over OCR.
- **Corrupted PDF with partial text**: If `pdf-parse` throws (not returns empty), the error propagates to the catch block and the document is marked `failed`. OCR should NOT be a recovery path for corrupt PDFs — those are fundamentally broken files.

---

## TASK 3 — OCR Pipeline Design

### Pipeline (Modified)

```
POST /api/documents/upload
  ↓
validateDocumentUpload
  ↓
storageProvider.saveFile
  ↓
documentsRepository.insertDocument (status: "uploaded", progress: 10)
  ↓
documentOrchestrator.startDocumentIngestion
  ↓
processDocument:
  1. updateStatus("extracting", 30)
  2. readFile → extractTextFromUpload (pdf-parse)
     ↓
     ┌─ [fileType != 'pdf' OR text >= 50 chars] ──→ use extracted text
     │
     └─ [fileType == 'pdf' AND text < 50 chars]
          ↓
       3. updateStatus("ocr", 45)
       4. extractPdfImages (pdfjs-dist, page-by-page)
       5. ocrImage (tesseract.js, sequential per page)
       6. combine OCR text
          ↓
  7. updateDocumentText (with OCR result)
  8. updateStatus("chunking", 60)
  9. chunkService.chunkDocument
 10. updateStatus("embedding", 90)
 11. embeddingService.embedDocument
 12. markReady (100)
```

### Page Limits

**Hard limit: 20 pages.**

- At ~5-10 seconds per page (Tesseract on Railway's 512MB-1GB), a 20-page PDF takes 100-200 seconds.
- Beyond 20 pages, the time-to-completion exceeds reasonable user expectations and Railway's request timeout (30s on Hobby, 300s on Pro).
- 20 pages covers the vast majority of scanned resumes, contracts, and notes.
- If a PDF exceeds 20 pages and triggers OCR, only the first 20 pages are OCR'd. The document is marked `ready` with a note that some pages were skipped.

### Concurrency

**Sequential page processing, no concurrency.**

- Tesseract.js already uses a worker pool internally. Adding parallel page jobs would multiply memory usage (each worker loads language data).
- Sequential processing keeps memory at ~200-300MB peak.
- Railway hobby tier has 512MB — sequential is the only safe option.

### Memory Usage

| Component | Memory |
|-----------|--------|
| pdfjs-dist rendering (one page) | ~50-100MB |
| Tesseract worker (single) | ~100-150MB |
| Buffer for page image | ~10-30MB |
| **Peak total** | **~200-300MB** |

This fits within Railway's 512MB hobby tier but is tight. If memory becomes an issue, downsample images to 1024px width before OCR.

### Failure Handling

- **Per-page failure**: If a single page fails OCR, log the error and continue with remaining pages. The document is not marked failed unless ALL pages fail.
- **Tesseract worker crash**: If the worker process crashes, restart it (tesseract.js v4+ handles this). If restarts fail, mark the document as `failed` with the error.
- **Timeout safeguard**: If total OCR time exceeds 300 seconds, abort, use whatever text was extracted so far, and continue to chunking/embedding. The document is still marked `ready` with potentially partial text.
- **Zero pages OCR'd**: If no pages could be OCR'd, the document is marked `failed` with "OCR was unable to extract text from this PDF."

---

## TASK 4 — Library Evaluation

### 1. pdfjs-dist (for rendering PDF pages to images)

| Criterion | Assessment |
|-----------|-----------|
| Node.js compatibility | Full — provides `getDocument()` for loading PDFs, `page.render()` for rendering to canvas |
| Current version | 4.x stable, ESM support in v4 |
| Current dependency | **NOT installed** (would need `npm install pdfjs-dist`) |
| Canvas dependency | Needs `canvas` (node-canvas) for server-side rendering, OR can use `pdfjs-dist/legacy/build/pdf` with Node canvas polyfills |
| Railway compatibility | `canvas` npm package requires native compilation — may need buildpacks or prebuilt binary. Works on Railway with `apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev` buildpack or use `@napi-rs/canvas` as lighter alternative |
| Alternatives | Use `sharp` to convert raw pixel data from pdfjs, or use `pdf2pic` wrapper. But `canvas` is the most standard approach. |

**Verdict**: Use **pdfjs-dist** but be aware that node-canvas requires build dependencies on Railway. Alternative: Use pdfjs-dist's built-in `NodeCanvasFactory` or render to raw pixel data with `sharp` instead of `canvas`.

### 2. tesseract.js (for OCR)

| Criterion | Assessment |
|-----------|-----------|
| Node.js compatibility | Full — v4+ supports both ESM and CJS |
| Current version | 7.0.0 (already in `package.json`) |
| Current dependency | **Already installed** as `tesseract.js@^7.0.0` |
| Language data | Downloads `eng.traineddata` on first run (~8MB), cached to `~/.tesseract.js-data` |
| Railway compatibility | Works — no native deps in v7, uses WebAssembly internally. Language data can be pre-seeded via `TESSDATA_PREFIX` env var |
| Memory requirement | ~100-150MB per worker |
| Accuracy | Good for printed text at 300+ DPI; degrades with handwriting |
| Speed | ~2-5 seconds per page on Railway-grade CPU |

**Verdict**: Use **tesseract.js** — already a dependency, no native compilation, good accuracy for printed/scanned documents, reasonable speed.

### Recommendation

| Role | Library | Why |
|------|---------|-----|
| PDF rendering | **pdfjs-dist** + **sharp** (instead of canvas) | Avoids native build issues with node-canvas on Railway |
| OCR engine | **tesseract.js** (already installed) | Mature, no native deps, works out of box |

Using `sharp` instead of `canvas`:
- `sharp` is already widely used and available as prebuilt binary (no compilation needed on Railway)
- pdfjs-dist can render to a `Uint8Array` raw pixel buffer, which `sharp` can convert to PNG/JPEG in memory
- This avoids `node-canvas` entirely, eliminating the cairo/pango build dependency

---

## TASK 5 — Database Impact

### Status Enum Change

Current constraint:
```sql
CHECK (status IN ('uploaded', 'extracting', 'chunking', 'embedding', 'ready', 'failed'))
```

New constraint:
```sql
CHECK (status IN ('uploaded', 'extracting', 'ocr', 'chunking', 'embedding', 'ready', 'failed'))
```

### Migration

```sql
-- Drop old constraint
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;

-- Add updated constraint
ALTER TABLE documents
  ADD CONSTRAINT documents_status_check
  CHECK (status IN ('uploaded', 'extracting', 'ocr', 'chunking', 'embedding', 'ready', 'failed'));
```

### Migration File

Create: `database/migrations/20260617_add_ocr_status.sql`

### UI Implications (Frontend)

**`useDocuments.js`** — Add `'ocr'` to `POLLING_STATUSES`:
```js
const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'ocr', 'chunking', 'embedding']);
```

**`WorkspacePage.jsx`**:
- `getDocumentStatusLabel`: Add `if (status === 'ocr') return 'OCR';`
- `getDocumentStatusTone`: `'ocr'` returns `'loading'` (same as other processing states)
- The progress bar should show ~45% during OCR (same as current `extracting` step)

No new columns needed. The existing `progress`, `failure_reason`, `processing_started_at`, and `updated_at` columns handle the OCR state identically to how they handle `extracting`.

---

## TASK 6 — UX Design

### Document States Flow

| State | Progress | Label (Frontend) | Notes |
|-------|----------|-------------------|-------|
| `uploaded` | 10 | Uploaded | File saved to disk, ingestion pending |
| `extracting` | 30 | Extracting | pdf-parse running |
| `ocr` | 45 | OCR | Tesseract processing (only when triggered) |
| `chunking` | 60 | Chunking | Text being split into chunks |
| `embedding` | 90 | Embedding | Chunks being embedded |
| `ready` | 100 | Ready | Complete |
| `failed` | 100 | Failed | Error message shown |

### Progress Messaging

**During OCR (45%)**: Display "Reading scanned text..." rather than just "OCR" for better UX. The `getDocumentStatusLabel` function can return more descriptive text:

```
status === 'ocr'    → 'Reading scanned text...'
status === 'extracting' → 'Extracting text...'
```

### Error Handling

- OCR failure shows: "This PDF could not be read. The document may be damaged or contain only unreadable images."
- Partial OCR failure (some pages failed, some succeeded): Document completes as `ready`. The failure reason field is NOT set for partial failures — the user gets a usable document.
- Total OCR failure (0 pages): Document goes to `failed` with `failureReason: "OCR was unable to extract text from this PDF. Ensure pages contain readable text."`

### OCR Failure Behavior

| Scenario | Behavior |
|----------|----------|
| pdf-parse returns 0 chars, OCR succeeds | Normal flow — document processed with OCR text |
| pdf-parse returns 0 chars, OCR fails entirely | Document marked `failed` with clear message |
| pdf-parse returns 0 chars, OCR partial | Document marked `ready` with partial text |
| pdf-parse returns text >50 chars | OCR never runs — normal flow |

---

## TASK 7 — Performance Analysis

### Time Estimates (Railway Hobby Tier, ~0.5-1 vCPU)

| Operation | Time |
|-----------|------|
| pdfjs-dist render (single page, 72 DPI) | ~0.3-1s |
| sharp conversion (RGBA → PNG buffer) | ~0.1-0.3s |
| tesseract.js OCR (single page, printed text) | ~2-5s |
| tesseract.js worker initialization (first run) | ~3-5s (one-time) |
| **Total per page (OCR)** | **~3-7s** |
| **Total: 10-page PDF** | **~30-70s** |
| **Total: 20-page PDF (max)** | **~60-140s** |

### Max Page Count Recommendation

**20 pages**. Rationale:
- At ~5s/page average, 20 pages = 100s of OCR time
- Railway Pro tier has 300s timeout — 100s is safe
- Railway Hobby tier has 30s timeout — OCR will exceed this. Mitigation: the fire-and-forget pattern (`void processDocument()`) means the HTTP response has already been sent. The document processing continues asynchronously. The DB writes happen regardless. The frontend polls for status. So the request timeout is not a blocker — the background Node.js event loop continues.
- However, Railway may kill idle processes. If the OCR takes >30s on Hobby, the process MAY be terminated. **Recommendation**: Document OCR as a "Pro-tier feature" for documents >5 pages, OR accept that Hobby users may have intermittent OCR failures for large documents.

### Safeguards

1. **Hard page limit**: 20 pages — refuse to OCR beyond this
2. **Per-page timeout**: 15s per page — if a single page takes longer, skip it
3. **Total timeout**: 300s total — abort OCR and use whatever text was extracted
4. **Memory guard**: Track `process.memoryUsage()` before each page — if heap > 400MB, abort and mark failed
5. **Rate limiting**: OCR is CPU-intensive. If multiple OCR jobs run simultaneously on Railway, they compete for CPU. Use a simple mutex or queue to ensure only one OCR job runs at a time within a single Node process.

---

## TASK 8 — Security Review

### File Execution Risks

- **pdfjs-dist**: Parses PDF structure in JavaScript. No native code execution from malformed PDFs — pdfjs is battle-tested in Firefox.
- **tesseract.js**: Runs WebAssembly-compiled Tesseract. The Wasm binary is cryptographic-signed and loaded from the package. No shell execution.
- **sharp**: Process image conversion in C++, but exposed via safe Node.js API. No risk.

**Verdict**: No file execution risks.

### Path Traversal Risks

- OCR operates on `storagePath` which is generated by `LocalStorageProvider.saveFile` using a UUID prefix — no user-controlled path components.
- The output of OCR is text stored in the `extracted_text` column. No file writes occur during OCR.

**Verdict**: No path traversal risks.

### Ownership Checks

- `processDocument` in `documentOrchestrator.js` uses `getDocumentById` (no `ForUser` variant). This was identified in the system audit as a pre-existing issue. OCR does not change or worsen this — the same concern applies equally to `extracting`, `chunking`, and `embedding` stages.
- The upload route enforces ownership before inserting the document. Once the document is owned by a user, the ingestion pipeline (including OCR) operates on that document without additional checks. This is acceptable because ingestion is triggered only by the user's upload action.
- The OCR step is called from `processDocument`, which is called from `startDocumentIngestion`, which is called synchronously after `insertDocument` in the upload route. No external actor can trigger OCR on another user's document.

**Verdict**: No new ownership bypass risks.

### Additional Considerations

- **Language data download**: tesseract.js downloads `eng.traineddata` (~8MB) on first use. This is an outbound HTTP request. Ensure it uses HTTPS and the data is checksummed by the package.
- **Memory exhaustion**: An attacker uploading multiple large scanned PDFs simultaneously could exhaust server memory. Mitigation: Sequential OCR queue (single job at a time), plus the existing 25MB file size limit limits the max image size.

---

## Summary: Implementation Plan

### Recommended Architecture (Final)

```
documentOrchestrator.processDocument (modified)
  ├── extracting (30%) ← pdf-parse
  │     └── if PDF + text < 50 chars:
  │           ├── ocr (45%) ← pdfjs-dist + sharp + tesseract.js
  │           │     ├── per-page loop (max 20)
  │           │     ├── render page to PNG via pdfjs-dist + sharp
  │           │     └── OCR via tesseract.js
  │           └── use OCR result as extractedText
  ├── chunking (60%)
  ├── embedding (90%)
  └── ready (100%)
```

### Libraries to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `pdfjs-dist` | ^4.x | Render PDF pages to images |
| `sharp` | ^0.33.x | Convert raw pixel data to PNG buffer (avoid node-canvas) |

No additional native dependencies needed — `sharp` has prebuilt binaries.

### Database Changes

1. New migration: `20260617_add_ocr_status.sql`
   - Drop + recreate `documents_status_check` constraint to include `'ocr'`

### Files Affected

| File | Change |
|------|--------|
| `server/documents/documentOrchestrator.js` | Add OCR fallback branch in `processDocument` |
| `server/documents/extractText.js` | Change behavior: return (not throw) for empty text; add threshold check; add OCR entry point |
| `server/ocr/ocrService.js` | **New file** — `createOcrService()` with `ocrPdf(buffer, maxPages)` |
| `server/ocr/pdfRenderer.js` | **New file** — render PDF page to PNG buffer using pdfjs-dist + sharp |
| `server/ocr/ocrText.js` | **New file** — tesseract.js wrapper with worker management |
| `server/app.js` | Wire OCR service into document orchestrator |
| `database/schema.sql` | Update CHECK constraint to include 'ocr' |
| `database/migrations/20260617_add_ocr_status.sql` | **New file** — migration |
| `web/src/hooks/useDocuments.js` | Add 'ocr' to POLLING_STATUSES |
| `web/src/pages/WorkspacePage.jsx` | Add 'ocr' label to `getDocumentStatusLabel` |

### Files NOT Affected

| File | Reason |
|------|--------|
| `server/chat/*` | No chat changes |
| `server/search/*` | No search changes |
| `server/retrieval/*` | No retrieval changes |
| `server/embeddings/*` | No embedding changes |
| `server/ingestion/*` | Chunking is downstream, unchanged |
| `server/storage/*` | No storage changes |
| `web/src/api/atlasApi.js` | No API contract changes |
| `web/src/components/*` | No UI component changes (status labels only) |

### Implementation Order

1. **Install dependencies**: `npm install pdfjs-dist sharp`
2. **Create `server/ocr/pdfRenderer.js`**: pdfjs-dist wrapper that renders PDF pages to in-memory PNG buffers, max 20 pages, sequential
3. **Create `server/ocr/ocrText.js`**: tesseract.js wrapper with worker lifecycle, per-page OCR, error isolation
4. **Create `server/ocr/ocrService.js`**: `createOcrService()` that ties renderer + OCR together, handles page limits, timeouts, memory guard
5. **Modify `server/documents/extractText.js`**: Change `extractTextFromUpload` to return `extractedText: ''` instead of throwing for scanned PDFs. Add threshold logic.
6. **Modify `server/documents/documentOrchestrator.js`**: Add OCR fallback branch between extract and chunk
7. **Wire in `server/app.js`**: Create OCR service, pass to orchestrator (or call within `processDocument`)
8. **DB migration**: `database/migrations/20260617_add_ocr_status.sql`
9. **Update `database/schema.sql`**: Include `'ocr'` in CHECK constraint
10. **Frontend**: Add `'ocr'` to POLLING_STATUSES, add label to `getDocumentStatusLabel`
11. **Verify build**: `npm run build`
