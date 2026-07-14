# Roadmap

## Completed

### Authentication
- Email/password signup and login via Better Auth
- Session management with httpOnly cookies
- Permissive `authMiddleware` populates `req.user` on all routes
- Auth-specific rate limiter (10 POST/15min) on credential endpoints
- General API rate limiter (200 req/15min)
- Frontend `ProtectedRoute` and `GuestRoute` wrappers
- Better Auth schema (user, session, account, verification tables) with Drizzle ORM adapter

### Document Ingestion Pipeline
- File upload with Multer (25MB limit, memory storage)
- File type validation: PDF and TXT only
- Text extraction via pdf-parse for PDFs, UTF-8 read for TXT
- Fire-and-forget ingestion: `void processDocument()` returns HTTP 201 immediately
- Sequential pipeline: extracting -> chunking -> embedding -> ready
- Status tracking with progress percentage (10/30/60/90/100) and polling-based frontend updates
- Polling with exponential backoff (2s -> 10s max, 10-minute timeout)
- Document rename and delete with optimistic UI updates
- `stripInternalDocumentFields` removes `storagePath` from API responses

### OCR Pipeline
- PDF page rendering via pdfjs-dist + @napi-rs/canvas (2560px max dimension clamp)
- OCR via tesseract.js (English, sequential pages, per-page error isolation)
- Threshold-based OCR trigger: PDFs with < 50 characters of extracted text
- OCR file size guard (15MB default, env-configurable)
- Sequential in-process queue (max depth 5, 300s acquire timeout, try/finally lock)
- OCR quality scoring (alpha ratio, average word length, dictionary ratio, printable ratio)
- OCR quality persisted to `documents.ocr_quality` column
- Max 10 pages OCR'd per document
- Startup reconciliation for stuck processing states (30-minute timeout)

### Semantic Search
- pgvector vector(384) column on chunks table
- HNSW index with cosine distance (`vector_cosine_ops`)
- Query embedding via HuggingFace Inference API (model: BAAI/bge-small-en-v1.5)
- Conversation-scoped search (filter by conversation's attached documents)
- User-scoped search (filter by user_id)
- Top-K and similarity threshold limits (configurable, max 12)

### Chat and RAG
- SSE streaming chat with 15-second heartbeat
- AbortController-based mid-stream cancellation
- Conversation CRUD (create, list, rename, delete)
- Message persistence (user and assistant turns)
- Document-to-conversation attachment and detachment
- RAG routing: vector similarity + term overlap gate (`topSimilarity >= 0.50 && overlapCount >= 1`)
- Explicit document match detection (user asks about a document by name)
- Follow-up query support (short messages inherit last referenced document)
- Document summary query detection (regex patterns like "summarize", "tell me about")
- Low-quality OCR detection and graceful handling
- Auto-title generation from first user message (truncated to 60 chars at word boundary)
- History-limited context (last 6 messages)
- Conversation deletion cascades to orphaned document cleanup

### Standalone Generation
- POST /api/generate endpoint (non-streaming, single Q&A)
- RAG routing and fallback modes
- Fetch with retry (2 retries, exponential backoff, 15s timeout)
- Consistent prompt templates (RAG, fallback, summary)

### Error Handling
- Classified error hierarchy: ValidationError, ProviderError, DatabaseError
- `classifyError` maps errors to categories and HTTP status codes (400, 502, 503, 500)
- Global ErrorBoundary React component with recovery UI
- Unhandled rejection and uncaught exception logging
- Graceful shutdown (SIGTERM/SIGINT) with 10-second forced-exit timeout

### Frontend
- Landing page, login page, signup page with TailwindCSS styling
- Workspace page with sidebar, chat transcript, document list, search view
- Dark theme with custom Atlas design tokens (atlas-teal, atlas-sky, atlas-ink, etc.)
- React Router v7 with four routes: `/`, `/login`, `/signup`, `/app`
- Mobile-responsive layout with drawer navigation
- Document attach modal with search
- Optimistic UI updates for rename and delete operations
- Stale request guards (`activeRequestRef.current` comparison)

### Deployment
- Vite dev server with API proxy configuration
- Vercel static deployment (SPA rewrite all routes to index.html)
- serverless-http wrapper for serverless API deployment
- Railway-compatible long-running Node.js process
- Health check endpoints (`/api/health`, `/api/health/db`, `/api/status`)

---

## In Progress

### Cross-Site Authentication
- Recent commit `f6f0b1e` ("fix: enable cross-site auth cookies") and `e4779ef` ("fix: add production start script") indicate ongoing auth configuration issues
- The `auth.js` sets `sameSite: "none"` with `secure: true`, which requires HTTPS — dev environment may have cookie compatibility issues

### Local Embedding Provider Stub
- `server/embeddings/LocalTransformersProvider.js` is an empty stub — both `embed()` and `embedMany()` throw `"LocalTransformersProvider is not implemented yet."`
- The `EMBEDDING_PROVIDER` env var accepts `'local'` or `'local-transformers'` but will crash at runtime if selected

### Streaming Message Persistence Race Condition
- Server persists the assistant message AFTER `response.end()` in the stream route (`routes.js:156-177`)
- If the DB write fails, the user has already received the streamed response but the message is lost on page reload
- SYSTEM_AUDIT.md explicitly flags this: "the DB write happens after the HTTP response is complete"

### Pending TODO in Frontend
- `web/src/hooks/useChat.js:404`: TODO comment to remove a commented-out `fetchConversationDocuments` call after confirming no race condition

---

## Planned

Features that are scaffolded but not implemented, based exclusively on code evidence.

### Multi-Provider Generation
- `server/generation/GenerationProvider.js` defines the abstract interface (`generate()` and `generateStream()`)
- Only `GroqProvider` is implemented
- `app.js` reads no `GENERATION_PROVIDER` env var currently — only Groq is wired
- The `createGenerationConfig` reads `GENERATION_PROVIDER` from env, suggesting future routing

### Cloud Storage Provider
- `server/storage/provider.js` defines abstract interface (`saveFile`, `ensureReady`, `deleteFile`)
- Only `LocalStorageProvider` is implemented (writes to `uploads/` directory)
- A cloud provider (S3, R2, GCS) can be added without changing the rest of the system

### Full Tenant Isolation (Ownership Enforcement)
- `user_id` columns exist on `documents` and `chat_threads` but are nullable
- Repository methods have `ForUser` variants (e.g., `getDocumentByIdForUser`, `listDocumentsForUser`)
- `processDocument` uses the non-ForUser `getDocumentById` — no ownership check during ingestion
- AUTH_INTEGRATION.md "Next steps" lists: "Wire ownership-aware repository methods behind auth checks"

### OCR Language Configuration
- OCR is hardcoded to English (`'eng'`) in `ocrText.js`
- OCR_OPERATIONAL_RESILIENCE.md recommends: "Add language configuration in a follow-up: `OCR_LANGUAGE` env var, per-document language override"

### OCR Retry Button
- OCR_OPERATIONAL_RESILIENCE.md explicitly defers: "Not for v1. Delete + re-upload is sufficient."
- A retry button would need to reset status, clear failure_reason/failed_at, and re-trigger ingestion

### Periodic Stuck Document Reconciliation
- Startup reconciliation exists but only runs on process start
- OCR_OPERATIONAL_RESILIENCE.md: "A periodic 5-minute cron-style reconciliation can be added in a later iteration"

### Standalone API as Public Integration Point
- `POST /api/generate` exists alongside the chat system, sharing the same generation and retrieval services
- Documented as a potential public API integration point for question-answering without conversation context

---

## Technical Debt

### Production Readiness

| Issue | Evidence | Location |
|-------|----------|----------|
| `.env` committed with live API keys | File contains valid `GROQ_API_KEY`, `HF_API_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET` | `.env` |
| Temporary `console.log` statements | 42 structured log lines with `[OCR]`, `[atlas]`, `[DOC MATCH]`, `[RAG CHUNK]`, `[SUMMARY PROMPT PREVIEW]` prefixes — intended for dev debugging | `chatService.js`, `generationService.js`, `ocrService.js`, `ocrText.js`, `pdfRenderer.js`, `documentOrchestrator.js` |
| `BETTER_AUTH_URL` defaults to localhost | Falls back to `http://localhost:8787` if env var not set | `server/auth.js:85` |
| Duplicate code in api/index.js | The same import + export block appears twice (lines 1-5 and 6-10) | `api/index.js` |

### Code Quality

| Issue | Evidence | Location |
|-------|----------|----------|
| `computeOverlap` duplicated | Identical function exists in both files with no shared import | `chatService.js:6-14`, `generationService.js:4-12` |
| Hardcoded RAG thresholds | 0.50 similarity and overlapCount >= 1 are magic numbers | `chatService.js:361,584`, `generationService.js:95` |
| No login-specific rate limiting | Auth limiter covers credential endpoints at 10/15min, but doesn't distinguish between login and signup failures | `server/app.js` |
| Hardcoded embedding dimension | Vector(384) is tied to `BAAI/bge-small-en-v1.5` — switching models requires schema migration | `database/schema.sql` |
| Streaming fetch uses no retry | `GroqProvider.generateStream()` calls `fetch()` directly, not `fetchWithRetry` | `server/generation/GroqProvider.js:101` |

### Frontend

| Issue | Evidence | Location |
|-------|----------|----------|
| `conversationDocumentsLoading` not set before fetch | `selectConversation` does not set loading = true before the async call | `useChat.js` (noted in SYSTEM_AUDIT.md) |
| Sequential attach with no rollback | If 1 of 10 attachments fails, the first 9 remain attached | `DocumentAttachModal.jsx` (noted in SYSTEM_AUDIT.md) |
| Orphan conversations on validation failure | If message validation fails after conversation creation, the empty conversation persists | `chatService.js` (noted in SYSTEM_AUDIT.md) |

### Infrastructure

| Issue | Evidence | Location |
|-------|----------|----------|
| No migration runner | Migrations are SQL files applied manually — no tool tracks which have been run | `database/migrations/` |
| No periodic reconciliation | Recovery only runs at startup; a process crash + long uptime leaves stuck documents unrecovered | `server/documents/reconcileStuckDocuments.js` |

---

## Milestones

### v1.0 — Baseline RAG Platform (current)
*Tagged as `release/atlas-v1` in git. Represents the shipped baseline.*

- Document upload and ingestion (PDF/TXT)
- Text extraction via pdf-parse
- Fixed-window chunking (500 chars, 100 overlap)
- pgvector embedding and HNSW search
- Chat with SSE streaming and RAG routing
- Email/password authentication via Better Auth
- Vercel + Railway deployment

### v1.1 — OCR and Resilience (merged to main)
*Implemented across `feat/ocr-ingestion` branch. Currently in main.*

- OCR fallback for scanned PDFs (pdfjs-dist + @napi-rs/canvas + tesseract.js)
- Sequential OCR queue with max depth and timeout
- OCR quality scoring
- Startup reconciliation for stuck documents
- Conversation-document attachment system
- Document summary queries

### v1.2 — Production Hardening (scaffolded, partial)
*Auth improvements, extracted to `feat/auth-routing` branch.*

- Cross-site cookie support (sameSite: none, secure: true)
- Production start script
- Additional error handling cleanup needed

### v1.3 — Multi-Provider Support (scaffolded)
*Provider abstractions exist but only one implementation each.*

- Generation: add OpenAI or Anthropic provider alongside Groq
- Embeddings: implement LocalTransformersProvider (stub exists)
- Storage: add S3/R2 provider alongside LocalStorageProvider

### v1.4 — Tenant Isolation (scaffolded)
*Ownership columns and ForUser methods exist but not fully wired.*

- Enforce ownership checks in document orchestrator's `processDocument`
- Activate non-null `user_id` constraints
- RBAC if required

### v1.5 — Polish and DX (documented improvements)
*All items are flagged in SYSTEM_AUDIT.md or OCR documentation.*

- Remove temporary `console.log` statements
- Extract `computeOverlap` to shared utility
- Make RAG routing thresholds configurable via env vars
- Add periodic (5-minute) stuck document reconciliation
- Add migration runner or tracking
- Remove `.env` from version control
- Fix duplicate code in `api/index.js`
- Add OCR language configuration (`OCR_LANGUAGE` env var)
