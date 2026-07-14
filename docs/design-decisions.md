# Design Decisions

## JavaScript over TypeScript

### Context

The repository is a full-stack application with a Node.js backend and React frontend. The build tool (Vite) natively supports TypeScript with zero configuration.

### Decision

The entire codebase is written in JavaScript (CommonJS-style imports with `import`/`export` ESM syntax in `.js` and `.jsx` files). There are no `.ts` or `.tsx` files anywhere in the repository. No TypeScript configuration files (`tsconfig.json`) exist.

### Alternatives Considered

TypeScript was considered and explicitly rejected. The README states: "The codebase is now JavaScript-first, so there is no TypeScript check step in this scaffold."

### Consequences

**Positive:**
- Faster iteration with no type-checking build step
- Simpler toolchain (no `tsconfig.json`, no type definitions to maintain)
- Lower barrier for contributors

**Negative:**
- No compile-time type safety across the codebase
- No self-documenting type signatures on function boundaries
- Runtime errors from type mismatches are caught late

### Future Improvements

No TypeScript migration path is mentioned anywhere in the codebase or documentation. If type safety is desired, the project would need a full migration from scratch.

---

## Monorepo with Concurrent Dev Server

### Context

The project has two separate runtime environments: a Vite dev server for the frontend (port 5173) and an Express API server for the backend (port 8787). Both need to run simultaneously during development.

### Decision

A single `package.json` at the monorepo root uses `concurrently` to start both dev servers with one command. The Vite config proxies `/api/*` requests to the Express server during development. The `package.json` scripts are:
- `npm run dev` — runs both concurrently
- `npm run dev:web` — frontend only
- `npm run dev:api` — backend only
- `npm run build` — builds only the frontend

### Alternatives Considered

No alternative monorepo tools (Nx, Turborepo, Lerna) or separate `package.json` files per workspace are referenced anywhere in the codebase.

### Consequences

**Positive:**
- Single `npm run dev` to start the full stack
- Unified dependency management in one `package.json`
- Simple proxy configuration in `vite.config.js`

**Negative:**
- No isolated dependency trees per workspace
- The two layers are not independently deployable from different package roots

### Future Improvements

The `api/index.js` wraps the Express app with `serverless-http`, enabling Vercel serverless deployment of the API without the frontend. This decoupling already exists at the deployment layer.

---

## Express.js (Backend Framework)

### Context

The backend serves a REST API and SSE streaming endpoint. It handles file uploads, database queries, external API calls, authentication middleware, and request lifecycle management.

### Decision

Express.js is used as the web framework. The application follows a factory-function pattern where each module (`createDocumentsRouter`, `createChatService`, etc.) receives its dependencies via constructor arguments at wire-up time in `server/app.js`. The middleware stack is ordered explicitly: helmet -> cookieParser -> cors -> morgan -> authLimiter -> authHandler -> apiLimiter -> json body parser -> authMiddleware -> routes -> 404 handler.

### Alternatives Considered

No alternatives (Fastify, Koa, Hono) are referenced anywhere in the codebase.

### Consequences

**Positive:**
- Express is the most widely adopted Node.js web framework with extensive middleware ecosystem
- The dependency injection wiring in `app.js` makes module boundaries explicit
- Middleware ordering is predictable and visible in a single file

**Negative:**
- All middleware is in-process; Express does not provide built-in clustering or worker management
- The monolith means a crash in any module brings down the entire server

### Future Improvements

The `api/index.js` wraps the app with `serverless-http`, enabling serverless deployment. This does not change Express but adds a serverless-compatible entry point.

---

## React (Frontend Framework)

### Context

The frontend is a single-page application with client-side routing, real-time streaming chat, document management UI, and authentication forms.

### Decision

React 19 is used with `react-router-dom` v7 for routing. The application follows a hooks-based architecture: all API interaction is encapsulated in custom hooks (`useAuth`, `useChat`, `useDocuments`, `useSearch`, `useGenerate`, `useUpload`), and components consume these hooks. State management uses React useState and useRef only — no external state library.

### Alternatives Considered

No alternatives (Vue, Svelte, Angular, Solid) are referenced anywhere in the codebase.

### Consequences

**Positive:**
- Hooks pattern cleanly separates API logic from rendering
- No external state management library reduces dependency weight
- React's component model maps naturally to the workspace UI (sidebar, chat transcript, document list)

**Negative:**
- No data-fetching library (React Query, SWR, RTK Query) — caching, deduplication, and retry logic are manual
- The polling implementation in `useDocuments` and `useChat` uses raw `setTimeout` with backoff logic hand-rolled
- SSE stream parsing in `atlasApi.js` is implemented at the fetch layer rather than using a dedicated SSE client

### Future Improvements

- The polling pattern in `useDocuments.js` and `useChat.js` could be replaced with a standard data-fetching library. The backoff/retry logic is currently hand-rolled.
- The SSE client in `atlasApi.js` is a custom implementation. A dedicated SSE library could simplify the stream parsing.

---

## PostgreSQL with pgvector

### Context

The application stores documents, text chunks, conversation threads, messages, document-conversation associations, and authentication data. It also requires vector similarity search for semantic retrieval.

### Decision

Neon PostgreSQL is the sole data store. The pgvector extension provides vector(384) columns and an HNSW index with cosine distance for approximate nearest-neighbor search. The database schema spans 6 tables across two schemas: `public` (application tables) and `better_auth` (authentication tables). All application data access is through raw SQL queries via a `pg.Pool` connection. There is no ORM for application data.

### Alternatives Considered

No alternatives (MongoDB, SQLite, Pinecone, Weaviate) are referenced anywhere in the codebase.

### Consequences

**Positive:**
- Single data store for both relational data and vector embeddings — no operational complexity of managing a separate vector database
- Relational integrity via foreign keys: `chunks.document_id`, `conversation_documents.document_id`, `chat_messages.thread_id`
- Cascading deletes ensure no orphaned data when documents or conversations are removed
- The `UNIQUE(document_id, chunk_index)` constraint guarantees idempotent chunking

**Negative:**
- pgvector's HNSW index is approximate; exact search requires no index (or a different index type)
- The 384-dimensional vector limit is hardcoded in the schema and tied to the BAAI/bge-small-en-v1.5 model; switching models would require a migration
- No separation of read/write replicas in the connection pool

### Future Improvements

- The `LocalTransformersProvider` exists as a stub but throws "not implemented yet." Once implemented, it would allow local embedding inference without an external API.
- The `EmbeddingProvider` abstract class allows adding new embedding providers (e.g., OpenAI, Cohere) by implementing `embed()` and `embedMany()`.

---

## Better Auth (Authentication)

### Context

The application requires email/password signup and login, session management with httpOnly cookies, and per-request user identification. Routes need to conditionally identify authenticated users without blocking anonymous access.

### Decision

Better Auth is used as the authentication library. It is integrated via the Drizzle ORM adapter for PostgreSQL, with its own `better_auth` schema (4 tables: `user`, `session`, `account`, `verification`). The auth handler proxies `/api/auth/*` routes. A permissive `authMiddleware` reads the session cookie on all other requests and populates `req.user` without rejecting unauthenticated requests. Individual route handlers decide whether authentication is required.

### Alternatives Considered

No alternatives (Auth0, Clerk, NextAuth, Passport.js, Lucia) are referenced anywhere in the codebase.

### Consequences

**Positive:**
- Session management is cookie-based and httpOnly, which is resistant to XSS token exfiltration
- The permissive middleware pattern allows gradual rollout of authenticated features: the same endpoint can serve both anonymous and authenticated users
- A dedicated auth rate limiter (10 POST/15min) is applied to credential endpoints separately from the general API rate limiter (200 req/15min)

**Negative:**
- The Drizzle ORM is only used for Better Auth integration, not for application data — this adds an ORM dependency for a single integration point
- `BETTER_AUTH_URL` defaults to `http://localhost:8787` in `auth.js` — if not configured in production, authentication redirects/URLs will be incorrect

### Future Improvements

- Ownership columns (`user_id`) exist on `documents` and `chat_threads` but are nullable. Repository methods have `ForUser` variants ready. The SYSTEM_AUDIT.md notes this as a pre-existing concern for future tenant isolation.

---

## Groq (LLM Provider)

### Context

The application needs an LLM for chat generation and standalone question answering. Support is required for both synchronous generation and SSE streaming.

### Decision

Groq is the sole LLM provider. The `GroqProvider` extends the abstract `GenerationProvider` and implements both `generate()` (POST to `/chat/completions` with `stream: false`) and `generateStream()` (POST to `/chat/completions` with `stream: true`, returning an async generator that yields tokens). The Groq API is accessed at `https://api.groq.com/openai/v1` with an OpenAI-compatible API format. Model, temperature, and max tokens are configurable via environment variables.

### Alternatives Considered

The abstract `GenerationProvider` base class (`server/generation/GenerationProvider.js`) defines the interface for both `generate()` and `generateStream()`. This interface is designed for multiple implementations. However, no other provider (OpenAI, Anthropic, Together) is implemented or referenced anywhere in the codebase.

### Consequences

**Positive:**
- The OpenAI-compatible API format means the same request/response structure could work with other providers that support the same format
- The `GenerationProvider` abstract class allows adding new providers without changing the generation service
- `fetchWithRetry` provides exponential backoff (2 retries, 15s timeout) for transient failures

**Negative:**
- Single-provider dependency: if Groq is unavailable, the entire chat and generation system is down
- No fallback or failover to another provider
- The `.env` file checked into the repository contains a live Groq API key

### Future Improvements

- The `GenerationProvider` interface is ready for additional implementations. Adding OpenAI or Anthropic would require implementing the same `generate()` and `generateStream()` methods and adding a branch in `server/app.js`.
- The generation config in `config.js` already reads `GENERATION_PROVIDER` env var, suggesting multi-provider support was anticipated.

---

## Raw SQL over ORM for Application Data

### Context

The application performs CRUD operations on 6 database tables with complex queries: status-filtered polling, vector similarity search with cosine distance, ownership-scoped queries, and conditional updates with `RETURNING` clauses.

### Decision

All application data access uses raw SQL queries executed through a `pg.Pool` connection. Repository classes (e.g., `DocumentsRepository`, `ChunkRepository`) wrap queries in async methods with parameterized placeholders. Drizzle ORM is used exclusively for the Better Auth integration (via `@better-auth/drizzle-adapter`).

### Alternatives Considered

No alternatives (Drizzle for application data, Prisma, Knex, Sequelize, TypeORM) are considered anywhere in the codebase. The Drizzle import in `auth.js` is the only ORM usage in the entire project.

### Consequences

**Positive:**
- Full control over SQL: the pgvector HNSW index hint, cosine distance operator (`<=>`), `RETURNING` clauses, and complex `WHERE` filters are written directly
- No ORM abstraction overhead for vector search queries
- Database migrations are plain SQL files with no migration runner dependency

**Negative:**
- No schema migrations management tool — migrations are applied manually
- SQL is stringly-typed with no compile-time validation
- The `toDocumentSummary` / `toDocumentDetails` mapping functions are hand-written for every query result

### Future Improvements

- No migration tooling exists. If the schema evolves rapidly, a migration runner could be introduced. The current pattern of `CREATE TABLE IF NOT EXISTS` in `schema.sql` combined with numbered migration files works but does not track which migrations have been applied.

---

## Fire-and-Forget Document Ingestion

### Context

Document ingestion (extract text -> optionally OCR -> chunk -> embed) can take from seconds (for a small TXT file) to minutes (for a 10-page scanned PDF with OCR). The upload HTTP request should not block for the entire duration.

### Decision

After the upload route inserts the document row and returns HTTP 201, it calls `void documentOrchestrator.startDocumentIngestion(id)` without awaiting the result. The ingestion runs asynchronously in the background. The frontend polls `GET /api/documents/:id/status` to track progress. The `processDocument` method includes a status guard that prevents re-processing if the document is already in a processing state. If ingestion fails, the catch handler marks the document as `failed` via `documentsRepository.markFailed`.

### Alternatives Considered

No alternatives (message queue, worker thread, separate ingestion service) are referenced anywhere in the codebase. The OCR_ARCHITECTURE.md explicitly discusses Railway's 30s request timeout and notes that the fire-and-forget pattern avoids this limitation because the HTTP response is sent before ingestion begins.

### Consequences

**Positive:**
- Upload endpoint responds quickly (typically <100ms for validation + file write + DB insert)
- Multiple documents can be ingested concurrently (though OCR is sequential via its own queue)
- Failure in ingestion does not affect the upload response

**Negative:**
- If the Node.js process crashes mid-ingestion, the document remains in a processing state. The startup reconciliation (`reconcileStuckDocuments`) recovers these after 30 minutes.
- No visibility into ingestion progress from the upload response — the frontend must poll
- Unhandled rejections from the voided promise are caught by the top-level `unhandledRejection` handler

### Future Improvements

- The startup reconciliation (`reconcileStuckDocuments`) only runs at startup. The OCR_OPERATIONAL_RESILIENCE.md mentions periodic (5-minute) reconciliation as a planned enhancement.
- A dedicated job queue (Bull, Bee) could persist ingestion state and survive restarts.

---

## SSE over WebSocket for Chat Streaming

### Context

The chat endpoint needs to stream LLM token responses to the frontend in real time. The frontend needs to handle incremental token rendering, mid-stream cancellation, and error recovery.

### Decision

The chat streaming endpoint (`POST /api/chat/stream`) returns `text/event-stream` content type. The Groq provider's `generateStream()` returns an async generator that yields tokens. The chat route consumes this generator and writes SSE frames to the response. The frontend parses the SSE stream manually using `ReadableStream.getReader()` and a line-based parser. Heartbeats (`data: {"type":"ping"}`) are sent every 15 seconds to keep the connection alive.

### Alternatives Considered

No alternatives (WebSocket, WebRTC data channels, long polling) are referenced anywhere in the codebase. The SSE implementation exists in two places: the `GroqProvider.generateStream()` method reads Groq's own SSE stream and yields tokens, and the chat route writes a new SSE stream to the client response.

### Consequences

**Positive:**
- SSE is unidirectional (server to client), which matches the chat use case — the client sends a single POST and receives a stream of tokens
- SSE works over standard HTTP/1.1 with no upgrade negotiation or special proxy configuration
- The `AbortController` pattern in the frontend cancels both the fetch and the Groq stream signal

**Negative:**
- The frontend SSE parser is a custom implementation with manual buffer management and line splitting
- No built-in reconnection — if the stream drops mid-response, the user must retry the message
- Browsers have a per-domain SSE connection limit (typically 6), which could become a concern if multiple streaming endpoints are added

### Future Improvements

- The SSE parsing in `atlasApi.js` could be extracted into a reusable client utility
- Event IDs and reconnection logic could be added for resilience

---

## OCR Stack: pdfjs-dist + @napi-rs/canvas (not node-canvas)

### Context

The OCR pipeline needs to render PDF pages to images for Tesseract OCR. The rendering must work on Railway's Linux environment without native compilation dependencies.

### Decision

PDF pages are rendered using `pdfjs-dist` (the Mozilla PDF.js library running in Node.js) with a custom `NapiCanvasFactory` that uses `@napi-rs/canvas` instead of `node-canvas`. The `@napi-rs/canvas` package provides prebuilt N-API binaries for `linux-x64-gnu`, avoiding the need for system-level dependencies (cairo, pango) that `node-canvas` requires. The render dimension is clamped to 2560px maximum to prevent out-of-memory from ultra-high-resolution pages. The render scale is calculated as `min(1.5, 2560 / maxDimension)`.

### Alternatives Considered

Two alternatives were explicitly evaluated in `OCR_ENGINEERING_REVIEW.md`:

- **node-canvas**: Rejected because it requires system dependencies (`libcairo2-dev`, `libpango1.0-dev`, `libjpeg-dev`, `libgif-dev`) that would require buildpack configuration on Railway
- **sharp**: Initially specified in `OCR_ARCHITECTURE.md` as part of the stack (`pdfjs-dist + sharp`), but subsequently removed in `OCR_ENGINEERING_REVIEW.md` after analysis concluded that `@napi-rs/canvas` can produce PNG buffers directly via `canvas.toBuffer('image/png')`, eliminating sharp's ~30-50MB memory overhead and one native dependency

### Consequences

**Positive:**
- Zero native compilation during `npm install` — both packages provide prebuilt binaries
- The `NapiCanvasFactory` integrates directly with pdfjs-dist's rendering pipeline without image format conversion
- Memory-safe: `page.cleanup()` and `doc.destroy()` are called in `finally` blocks

**Negative:**
- pdfjs-dist is ~15MB installed (WASM worker, cmaps, font data)
- The 2560px dimension clamp may reduce OCR accuracy for very high-DPI scanned documents

### Future Improvements

- Language configuration for OCR is currently hardcoded to English (`eng`). The `OCR_OPERATIONAL_RESILIENCE.md` recommends a configurable `OCR_LANGUAGE` env var for future multi-language support.

---

## tesseract.js for OCR

### Context

The OCR pipeline needs to recognize text from rendered PDF page images. The solution must work in Node.js without native dependencies and be memory-efficient for Railway's 512MB hobby tier.

### Decision

tesseract.js v7 is used as the OCR engine. It was already a dependency in `package.json` at version `^7.0.0` before OCR was implemented. Pages are processed sequentially (one at a time) with a single Tesseract worker reused across pages, then terminated. Each page is wrapped in a try/catch so a single page failure does not fail the entire document. The language data is cached to a project-local path.

### Alternatives Considered

No alternatives (Google Cloud Vision, AWS Textract, Azure OCR, Tesseract via CLI) are referenced in the codebase. The `OCR_ARCHITECTURE.md` states: "tesseract.js (already installed) — Mature, no native deps, works out of box."

### Consequences

**Positive:**
- Zero additional dependencies — tesseract.js was already in `package.json`
- WebAssembly-based, no native compilation needed
- ~2-5 seconds per page on Railway-grade CPU for printed text

**Negative:**
- ~8MB `eng.traineddata` download on first use (cold start adds 3-5s latency)
- Each worker uses ~100-150MB of memory
- English-only; non-English documents produce poor results
- Sequential processing means a 10-page document takes ~30-70 seconds

### Future Improvements

- `OCR_LANGUAGE` env var for multi-language support (planned in OCR_OPERATIONAL_RESILIENCE.md)
- Pre-seeding language data in the deployment artifact to avoid cold-start download

---

## Sequential OCR Queue with In-Process Lock

### Context

OCR is CPU and memory intensive (peak ~285-405MB per job). Two concurrent OCR jobs on Railway's 512MB tier would exceed available memory. The pipeline also needs to handle queue depth limits and timeout on stuck acquisitions.

### Decision

An in-process sequential queue with a mutex lock is implemented in `ocrService.js`:
- `acquire()` sets a lock flag if the queue is empty; otherwise adds the caller to a FIFO callback array
- `release()` dequeues the next waiter or clears the lock
- Max queue depth is 5 — exceeding this returns a 503 immediately
- Queue acquisition timeout is 300 seconds — exceeding this returns a 504
- The lock is released in a `finally` block to prevent permanent lock on crash
- The queue only covers the OCR portion (pdf rendering + tesseract), not the full ingestion pipeline, so text extraction and chunking/embedding for non-OCR documents can run concurrently

### Alternatives Considered

No alternatives (BullMQ, Redis-based locks, separate worker processes) are referenced in the codebase. The `OCR_ENGINEERING_REVIEW.md` explicitly analyzed and approved the in-process queue design, noting that "Atlas runs as a single process on Railway, so this is fine."

### Consequences

**Positive:**
- Guarantees only one OCR job runs at a time, keeping memory within Railway's 512MB limit
- No external infrastructure (Redis, database) needed for queue state
- Timeout prevents permanent starvation if a job crashes without releasing the lock

**Negative:**
- The queue is in-process — a process crash loses all queued jobs (recovered by startup reconciliation)
- No cross-process synchronization: if the app is scaled to multiple instances, each has its own queue
- Queue depth of 5 means the 6th concurrent OCR request is immediately rejected

### Future Improvements

- A persistent queue (Bull with Redis) would survive process crashes and enable multi-instance deployments
- The `MAX_QUEUE_DEPTH` (5) and `QUEUE_ACQUIRE_TIMEOUT_MS` (300000) are hardcoded constants — they could be env-configurable

---

## RAG Routing with Term Overlap Gate

### Context

The chat and generation systems need to decide per-query whether to answer from retrieved document context (RAG mode) or fall back to the LLM's general knowledge. The decision must account for both vector similarity and lexical overlap.

### Decision

The system uses a two-gate RAG routing strategy. In `generationService.js`:
1. Retrieve chunks via vector similarity search (configurable topK, similarity threshold)
2. Compute `computeOverlap`: count of question terms (length >= 4) that appear in the concatenated chunk text
3. Route to RAG mode if `sources.length > 0 && topSimilarity >= 0.50 && overlapCount >= 1`
4. Otherwise route to fallback mode (LLM general knowledge)

The chat service (`chatService.js`) extends this with additional conditions:
- Explicit document match (user asks about a specific document by name) always triggers RAG
- Follow-up queries (short messages < 12 words in an existing conversation) use a lower bar: `overlapCount >= 1` without the similarity check
- Document summary queries bypass vector search entirely and use the full chunk list (up to 20 chunks, similarity = 1.0)

### Alternatives Considered

No alternative routing strategies (always-RAG, always-fallback, hybrid score weighting, re-ranking) are referenced in the codebase. The SYSTEM_AUDIT.md notes that 0.50 similarity and overlapCount >= 1 are hardcoded thresholds that could be made configurable.

### Consequences

**Positive:**
- The overlap gate prevents RAG mode from triggering on queries that have high vector similarity but no lexical connection (a known failure mode of embedding-only retrieval)
- Follow-up queries correctly reuse conversation context even when vector similarity is low
- Summary queries get the full document context rather than a top-K slice

**Negative:**
- The `computeOverlap` function is duplicated in `generationService.js` and `chatService.js` with identical logic
- The `overlapCount >= 1` threshold is very low — any query with a single 4+ character term that appears in a chunk triggers RAG
- The RAG routing threshold (0.50) differs from the retrieval similarity threshold (also defaults to 0.50 but is independently configurable)

### Future Improvements

- Extract `computeOverlap` to a shared utility module (noted in SYSTEM_AUDIT.md)
- Make the RAG routing thresholds configurable via env vars (noted in SYSTEM_AUDIT.md)
- Add a re-ranking step between retrieval and generation for better context selection

---

## Fixed-Window Text Chunking

### Context

Document text needs to be split into chunks for embedding and retrieval. Each chunk should be roughly uniform in size for consistent embedding quality while maintaining some context overlap between chunks.

### Decision

Text is split into fixed-size windows of 500 characters with 100 characters of overlap. The `chunkText` function in `server/ingestion/chunkText.js` produces chunk objects with a sequential `chunkIndex`, the text `content`, and a `characterCount`. The function validates that `overlap` is non-negative and smaller than `chunkSize`. Both values are configurable via options.

### Alternatives Considered

No alternatives (sentence splitting, paragraph splitting, recursive splitting, NLP-based segmentation) are referenced in the codebase. The SYSTEM_AUDIT.md notes: "Chunking is naive (fixed 500-char windows with 100-char overlap). No sentence/paragraph boundary detection. Acceptable for v1 but produces awkward chunk boundaries."

### Consequences

**Positive:**
- Simple, deterministic, fast — no NLP model or language-specific logic required
- Uniform chunk sizes produce uniform-quality embeddings
- The overlap ensures term boundaries near the cut point appear in at least one chunk

**Negative:**
- Chunks can split mid-sentence or mid-word, producing awkward retrieval contexts
- No awareness of document structure (headings, paragraphs, sections)
- 500 characters may be too small for some documents (context window underutilized) or too large for others (semantic meaning diluted)

### Future Improvements

Sentence-boundary-aware chunking, structural chunking (by heading/paragraph), or adaptive chunk sizing could improve retrieval quality. This is noted as a v1 limitation in SYSTEM_AUDIT.md.

---

## Multer Memory Storage (not Disk Storage)

### Context

File uploads need to be parsed from multipart/form-data requests. The uploaded file buffer is used for both disk persistence and text extraction/OCR within the same request handler.

### Decision

Multer is configured with `multer.memoryStorage()` — the uploaded file is held in memory as a `Buffer`. The buffer is used to write to disk via `LocalStorageProvider.saveFile()` and subsequently read back in `processDocument` via `fs.readFile`. The upload size limit is 25MB.

### Alternatives Considered

Multer's default `diskStorage` would write to a temporary directory first, requiring a second read from disk for text extraction. The memory storage pattern avoids this intermediate write.

### Consequences

**Positive:**
- The uploaded buffer is immediately available for both persistence and processing
- No cleanup of temporary files needed

**Negative:**
- A 25MB upload is held in memory alongside whatever other memory the request handler uses
- For very large concurrent uploads, memory pressure increases

### Future Improvements

No planned migration to disk storage or streaming uploads is referenced in the codebase.

---

## serverless-http for Vercel Compatibility

### Context

The Express API needs to run on both Railway (long-running Node.js process) and Vercel (serverless function environment where each request invokes the handler once).

### Decision

`serverless-http` wraps the Express app in `api/index.js` for Vercel deployment. The same Express app instance (`server/app.js`) is imported by both `server/index.js` (for Railway) and `api/index.js` (for Vercel serverless). The server files include duplicate `import` and `export` statements — a known issue in the codebase.

### Alternatives Considered

No alternatives (separate serverless entry point, rewrites without wrapper) are referenced.

### Consequences

**Positive:**
- One Express app definition supports both deployment modes without duplication (aside from the noted import duplication)
- No framework changes needed to support serverless

**Negative:**
- `api/index.js` has duplicate import/export statements (the same 5 lines appear twice)
- Serverless environments have request timeouts that may limit long OCR or ingestion tasks
- The fire-and-forget pattern (`void processDocument()`) may not work in serverless contexts where the runtime terminates after the response is sent

### Future Improvements

The `api/index.js` duplication is a bug that should be corrected. The OCR documentation (OCR_ARCHITECTURE.md) acknowledges that Railway's fire-and-forget approach is incompatible with serverless deployments for long-running tasks.
