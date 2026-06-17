# System Audit Report

## 1. Auth System

### Good
- **Better Auth** integration with email/password, `minPasswordLength: 8`
- **Rate limiting**: 50 requests/15min on `/api/*` (excluding `/api/auth/*`)
- **Session management**: Standard Better Auth sessions in `better_auth.session` table
- **Middleware separation**: `authHandler` for `/api/auth/*`, `authMiddleware` for all other `/api/*`
- **Cookie-based auth** with `credentials: 'include'` on frontend

### Issues
- **`server/auth.js:85`**: `BETTER_AUTH_URL` defaults to `http://localhost:8787` — will break in production if env var is not set. Should default to the Railway-assigned URL or be required at startup.
- **No login rate limiting**: `/api/auth/*` is excluded from the API rate limiter. Better Auth may have its own, but a dedicated auth-specific rate limiter (e.g., 10 attempts/15min per IP) would be more secure.
- **`server/auth.js:104`**: `trustedOrigins: [trustedFrontendOrigin]` accepts a single origin. If the app is accessed via custom domain + Vercel preview URLs, additional origins may need to be added.

## 2. Document Pipeline

### Good
- **Fire-and-forget ingestion** with proper error isolation (`processDocument` catches errors and marks document as `failed`)
- **Sequential pipeline**: Upload → extract → chunk → embed → ready, with progress tracking at each stage
- **Rollback on upload failure**: Storage file + DB row cleaned up on error
- **Upload auto-attach** rollback: If `attachDocument` fails during upload, the document is deleted
- **Polling-based status updates** on frontend (2s interval, 10min timeout)

### Issues
- **`server/documents/documentOrchestrator.js:29`**: `processDocument` uses `getDocumentById` (NOT `getDocumentByIdForUser`). No user ownership check during processing. While this is acceptable since processing happens server-side for a document the user just uploaded, it means an attacker who knows a document ID could potentially trigger processing via the `/api/documents/:id/chunk` or `/api/documents/:id/embed` endpoints.
- **`server/documents/routes.js:306-409`**: `/api/documents/:id/chunk`, `/api/documents/:id/embed` check ownership via `getDocumentByIdForUser` before proceeding — **this is correct**.
- **`server/documents/extractText.js:30-33`**: Scanned PDFs fail with "This PDF contains no extractable text. Scanned PDFs are not supported yet." — acceptable for now, OCR is planned.
- **`server/ingestion/chunkText.js`**: Chunking is naive (fixed 500-char windows with 100-char overlap). No sentence/paragraph boundary detection. Acceptable for v1 but produces awkward chunk boundaries.

## 3. RAG Retrieval

### Good
- **Conversation-scoped filtering** in SQL (`searchRepository.js:62-65`): `$4::uuid IS NULL OR chunks.document_id IN (SELECT document_id FROM conversation_documents WHERE conversation_id = $4::uuid)`
- **Early-exit optimization** (`chatService.js:140-153`): `countByConversation()` before retrieval skips embedding + vector search when 0 documents attached
- **Hybrid routing**: RAG if `topSimilarity >= 0.55 && overlapCount >= 1`, else LLM fallback
- **`topK` and `similarityThreshold` bounds-checked** (max 12 topK, parsed as integers)

### Issues
- **`server/chat/chatService.js:155-157` and `server/generation/generationService.js:93-95`**: The RAG decision threshold (`0.55`) is **hardcoded** in two places, while the retrieval similarity filter threshold (`0.5`) is configurable via `generationConfig.retrievalSimilarityThreshold`. This dual-threshold system is confusing — a chunk can pass the retrieval filter (>=0.5) but fail the RAG routing gate (>=0.55). Consider making both thresholds configurable or unifying them.
- **`computeOverlap` is duplicated** in `chatService.js:4-12` and `generationService.js:4-12`. Extract to a shared utility.
- **Standalone `/api/generate` endpoint** (`generationService.js:70-115`) duplicates the overlap/similarity check logic. This is by design (different entry point) but increases maintenance surface.
- **`overlapCount >= 1` is a very low bar**: A single 4+ character term overlap triggers RAG mode. This means almost any query with common words will trigger RAG if chunks are retrieved. Consider raising this threshold.

## 4. Chat Streaming

### Good
- **SSE implementation** with heartbeat every 15s, `X-Accel-Buffering: no` header for nginx compatibility
- **AbortController-based cancellation** on both client and server, with orphan message cleanup
- **Request UUID** (`randomUUID()`) for tracing stream events
- **`streamIdRef` pattern**: Old callbacks correctly compare against bumped ref to avoid stale state updates
- **Title generation**: First message truncated to 60 chars at word boundary
- **Transactional message append** with ownership check
- **Heartbeat cleanup**: Interval cleared on abort, stream error, or normal completion

### Issues
- **`server/chat/routes.js:122-131`**: Temporary `console.log` statements (`[chat-route]`, `[groq-stream]`, `[chat-service]`, `[generation-service]`) should be removed for production.
- **`server/chat/chatService.js:285-291`**: Same temporary logging.
- **`server/generation/GroqProvider.js:83-201`**: Extensive temporary logging in `generateStream`.
- **`server/chat/routes.js:160`**: `appendConversationTurnForUser` is called AFTER `response.end()` inside the non-aborted path. This means the DB write happens after the HTTP response is complete — if the DB write fails, the user has already received the streamed response. Acceptable trade-off (streaming is prioritized), but worth noting.
- **`server/chat/routes.js:160-181`**: The `assistantContent` persistence writes after `response.end()`. If the DB write fails, the conversation loses the assistant message. The user sees the answer in their UI but it won't persist on reload. A retry mechanism could help.

## 5. Security

### Good
- **Consistent `ForUser` pattern**: All repository methods that access user-scoped data have `ForUser` variants with `WHERE user_id = $2` enforcement
- **Document attachment**: Ownership of BOTH conversation AND document verified via `EXISTS` subqueries in a single SQL statement
- **Detachment**: Ownership enforced via `conversation_id IN (SELECT id FROM chat_threads WHERE ... AND user_id = $3)`
- **`stripInternalDocumentFields`**: `storagePath` removed from API responses
- **Rate limiting** on API endpoints
- **Error classification**: Internal errors return generic messages, no stack leaks
- **Error Boundary**: Catches React render errors gracefully
- **helmet()**: Standard security headers applied

### Issues
- **`server/documents/documentOrchestrator.js:29`**: `processDocument` uses `getDocumentById` (no user check). The orchestrator is called from `startDocumentIngestion` which is called after upload (user already verified), and from the ingestion pipeline. Low risk, but inconsistent.
- **`server/chat/conversationRepository.js:221-244`**: `getMessagesByConversationId` has NO ownership check. It is only called from `chatService.getConversationMessages` after ownership is verified via `getConversationByIdForUser` — but this is a **TOCTOU race condition**: between the ownership check and the message fetch, a malicious actor could delete the conversation and create a new one with the same ID (UUID collision is astronomically unlikely, so this is theoretical).
- **`server/search/searchRepository.js:10-42`**: `searchChunksByEmbedding` (non-ForUser variant) exists and is wired to `/api/search` route. The route checks `request.user?.id` and only passes userId to the ForUser variant — so this is dead code. But it's defense-in-depth: if someone accidentally wires it to a route, it would search ALL documents.
- **`server/retrieval/routes.js:20-24`**: Standalone `/api/retrieval` does NOT pass `conversationId` — by design, but worth verifying it's intentional.
- **`server/generation/routes.js:20`**: Standalone `/api/generate` does NOT pass `conversationId` — by design.

## 6. Frontend State Management

### Good
- **Optimistic updates** with rollback for rename/delete operations
- **Stale request guards** via `activeRequestRef.current` comparison in `selectConversation` and `fetchConversationDocuments`
- **`streamIdRef` pattern**: Correctly handles concurrent stream sends (increments BEFORE aborting, old callbacks compare against bumped ref)
- **`useDocuments` polling**: Polls every 2s while documents are processing, with 10min timeout
- **`sendChatMessageStream`**: Proper fetch with `AbortSignal`, `credentials: 'include'`, SSE parsing with buffer for split chunks
- **Normalizes message shapes**: Handles both `conversationId` and `threadId` field names

### Issues
- **`web/src/hooks/useChat.js:77-101`**: `selectConversation` does NOT set `conversationDocumentsLoading = true` before the async fetch. It's only set to `false` in the `finally` block. This means when switching conversations, the document loading state never transitions to `true` — the UI won't show a loading indicator for documents.
- **`web/src/hooks/useChat.js:57-75`**: `fetchConversationDocuments` correctly sets loading state, so the issue only occurs during the `selectConversation` initial load.
- **`web/src/components/DocumentAttachModal.jsx:56-67`**: Sequential attach (`for...of` loop) with no rollback on partial failure. If user selects 10 documents and the 5th fails, the first 4 are attached and the last 5 are not.
- **`web/src/pages/WorkspacePage.jsx:190-191`**: After upload, both `documents.reload()` and `chat.fetchConversationDocuments` are called — the first refreshes ALL documents, the second refreshes attached docs. This is correct but results in two API calls.
- **`web/src/hooks/useChat.js:104-120`**: `attachDocument` and `detachDocument` call `fetchConversationDocuments` after the operation, but the `DocumentAttachModal`'s `handleAttach` calls `onClose()` on success without waiting for the refresh. The refresh runs in the background — the UI might briefly show stale data.

## 7. Edge Cases

### Good
- **Empty conversation** (0 attached docs): Routes to fallback mode — correct per Option B model
- **Empty file / file too large**: Validated on client and server
- **Rate limit exceeded**: 429 JSON response with `rate_limit_exceeded`
- **Network errors in upload**: Error state set, user sees error message
- **Stream abort**: AbortController fires, orphan message cleaned up, status set to `aborted`
- **Rapid consecutive sends**: Old request aborted, orphan cleaned up, new stream ID guards against stale callbacks
- **Document deletion during processing**: `getDocumentById` returns null → pipeline silently no-ops → document marked failed if processing was in-flight at the exact moment of deletion
- **Stale conversation selection**: `activeRequestRef.current` comparison prevents stale state updates
- **All documents already attached**: Modal shows "All documents are already attached." empty state
- **No matching documents**: Search filter shows "No matching documents." empty state
- **No documents uploaded**: "No documents uploaded yet." empty state with helpful CTA
- **Global Error Boundary**: Catches React errors, provides "Try Again", "Refresh Page", "Return to Workspace" buttons, shows error message in dev mode

### Issues
- **`server/chat/chatService.js:130-134`**: New conversations created implicitly when no `conversationId` is provided. If the message fails validation after conversation creation, the orphan conversation remains. Low impact (empty conversations are hidden by the UI), but should be cleaned up.
- **`server/chat/chatService.js:227-234`**: Same issue in `chatStream` path.
- **`server/documents/routes.js:190`**: `void documentOrchestrator.startDocumentIngestion(persistedDocument.id)` — fire-and-forget. If ingestion fails, the document stays in `uploaded` status until the polling timeout (10min) on the frontend. The document is eventually marked as `failed` by `processDocument`, but there's a window where the user sees a stuck "uploaded" status.
- **`web/src/pages/WorkspacePage.jsx:237-238`**: During a new conversation's first streaming message, the right panel briefly shows "Document library" (no active conversation ID) then transitions to "Documents (0)" after stream completes. Minor UX quirk.

## Severity Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| **High** | 0 | — |
| **Medium** | 4 | `BETTER_AUTH_URL` default, hardcoded dual thresholds, `conversationDocumentsLoading` not set on select, extensive temp logging |
| **Low** | 9 | TOCTOU in message fetch, no login rate limiting, redundant `computeOverlap`, sequential attach no rollback, orphan conversations on validation failure, stale UI after attach, etc. |

## Recommendations (Priority Order)

1. **Remove temporary logs** (`[groq-stream]`, `[chat-service]`, `[generation-service]`, `[chat-route]`) across `GroqProvider.js`, `chatService.js`, `routes.js`, `generationService.js`
2. **Fix `conversationDocumentsLoading`** in `selectConversation` — add `setConversationDocumentsLoading(true)` at the start
3. **Extract shared `computeOverlap`** to a utility module, deduplicate across `chatService.js` and `generationService.js`
4. **Make RAG routing threshold configurable** — unify or expose `0.55` (currently hardcoded in 2 places)
5. **Add login-specific rate limiting** — e.g., 10 attempts/15min for `/api/auth/*` sign-in routes
6. **Either set `BETTER_AUTH_URL` via env check with startup validation, or use Railway URL**
7. **Clean up orphan conversations** on message validation failure
8. **Consider raising the `overlapCount >= 1` threshold** to reduce false-positive RAG triggers
