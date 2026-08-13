# Architecture

## Overview

Atlas is a personal knowledge platform that ingests PDF and TXT documents, performs semantic search via vector embeddings, and provides citation-aware chat against the ingested content. The system follows a client-server architecture with a Vite + React frontend and an Express.js API backend backed by Neon PostgreSQL with pgvector.

The core loop is: upload -> extract text -> optionally OCR -> chunk -> embed -> search/chat. The chat system uses a RAG (Retrieval-Augmented Generation) routing strategy that decides per-query whether to answer from retrieved document context or fall back to the LLM's general knowledge.

---

## High-Level Architecture

The system is split into two deployable units: a frontend SPA and a backend API server. In development they run concurrently; in production the frontend is built to static files and served by Vercel, while the API is deployed to a Node.js host (Railway).

The backend is a monolith organized into layered service modules. There is no message queue, no event bus, and no microservice boundary. All inter-module communication is in-process function calls wired together in `server/app.js` at startup via dependency injection.

The frontend is a single-page React application using react-router-dom for client-side routing. It communicates with the API exclusively over HTTP (REST JSON for CRUD, SSE for chat streaming). There is no WebSocket, no GraphQL, and no client-side state cache beyond React state.

---

## Component Diagram

An architecture diagram should contain the following components and their communication paths:

**Client Layer (Browser):**
- React SPA served from `web/src/`
- React Router v7 for `/`, `/login`, `/signup`, `/app` (workspace)
- TailwindCSS for styling, react-hot-toast for notifications

**API Gateway / Proxy Layer:**
- Vite dev server proxies `/api/*` to Express in development
- In production, Vercel rewrites all routes to `index.html` for SPA; API calls go directly to the backend origin set via `VITE_API_BASE_URL`
- Helmet for security headers, CORS, cookie-parser, morgan for logging, express-rate-limit

**Auth Layer:**
- Better Auth library handles signup, login, logout, session management
- Drizzle ORM with PostgreSQL adapter stores users, sessions, accounts, verification codes in `better_auth` schema
- `authHandler` proxies all `/api/auth/*` requests to Better Auth
- `authMiddleware` lazily populates `req.user` on all other API routes without rejecting unauthenticated requests

**Document Pipeline (orchestrator pattern):**
- `DocumentsRepository` — data access for the `documents` table
- `extractTextFromUpload` — validates file type, runs pdf-parse for PDFs, reads UTF-8 for TXT
- `createDocumentOrchestrator` — orchestrates the extraction -> OCR -> chunk -> embed sequence
- OCR module: `pdfRenderer` (pdfjs-dist + @napi-rs/canvas), `ocrText` (tesseract.js), `ocrService` (sequential queue with max depth 5)
- `ChunkService` + `ChunkRepository` — splits text into fixed-size chunks and persists to `chunks` table
- `EmbeddingService` + `EmbeddingRepository` — generates vector embeddings via HuggingFace or local-transformers and stores them in the `embedding` column

**Retrieval Layer:**
- `SearchService` + `SearchRepository` — accepts a query string, embeds it, runs cosine similarity search via pgvector HNSW index
- `RetrievalService` — thin wrapper around search that enforces conversation-document scoping

**Generation Layer:**
- `GenerationConfig` — parses env-var-based config (model, temperature, topK, etc.)
- `GroqProvider` — LLM provider for Groq's API (streaming and non-streaming)
- `GenerationService` — RAG routing: retrieves context, computes term overlap, decides RAG vs. fallback, builds prompts
- `PromptBuilder` — constructs system/user prompts with chunk citation format

**Chat Layer:**
- `ConversationRepository` — CRUD for `chat_threads` and `chat_messages`
- `ConversationDocumentRepository` — attach/detach documents to conversations via the `conversation_documents` junction table
- `ChatService` — orchestrates the full chat lifecycle: create conversation, stream response, persist messages, retrieve context, route to generation

**Storage Layer:**
- `StorageProvider` (abstract base) with `LocalStorageProvider` implementation — writes uploaded files to `uploads/` directory, keyed by UUID

**Error Layer:**
- Classified error hierarchy: `ValidationError`, `ProviderError`, `DatabaseError`
- `classifyError` maps errors to categories (validation, provider, database, internal) and HTTP status codes

**Startup/Operational:**
- `reconcileStuckDocuments` — on startup, fails any document stuck in processing states for >30 minutes
- Graceful shutdown handling for SIGTERM/SIGINT with 10-second forced-exit timeout
- Unhandled rejection/exception logging

---

## Data Flow

### Document Upload Lifecycle

1. User selects a file in the frontend `DocumentAttachModal`
2. `useUpload` hook sends a `POST /api/documents/upload` with `multipart/form-data`
3. Multer middleware parses the file (25MB limit, memory storage)
4. Route handler validates `requireAuthenticatedUser` — rejects with 401 if no session
5. `validateDocumentUpload` checks mime type: only `application/pdf` and `text/plain` are accepted
6. `LocalStorageProvider.saveFile` writes the buffer to `uploads/{uuid}-{sanitized-filename}` on disk
7. `DocumentsRepository.insertDocument` creates a row with status `uploaded`, progress 10
8. If `conversationId` is provided in the body, the document is immediately attached to the conversation via `ConversationDocumentRepository.attachDocument`
9. `documentOrchestrator.startDocumentIngestion` is fire-and-forget — the response (201) is sent immediately
10. Asynchronously, `processDocument` runs:
    - Status `extracting` (30%), runs `extractTextFromUpload`
    - If PDF and extracted text < 50 characters and OCR service is available: status `ocr` (45%), runs `ocrPdf`
    - OCR uses an in-process sequential queue (max 5 queued, 300s acquire timeout, try/finally lock release)
    - OCR pipeline: `pdfjs-dist` renders PDF pages to PNG buffers via `@napi-rs/canvas`, then `tesseract.js` performs OCR (English, sequential pages, per-page error isolation)
    - `computeOcrQuality` scores the extracted text using alpha ratio, average word length, dictionary ratio, printable ratio
    - Text and OCR quality score are persisted
    - Status `chunking` (60%): `ChunkService.chunkDocument` splits text into 500-character windows with 100-character overlap
    - Status `embedding` (90%): `EmbeddingService.embedDocument` generates embeddings for all chunks via the configured provider (HuggingFace `BAAI/bge-small-en-v1.5` or local transformers) and stores them in the `embedding` column
    - Status `ready` (100%) or `failed` (100%)
11. Frontend polls `GET /api/documents/:id/status` every 2 seconds (backing off to 10s max, 10-minute timeout) while status is in `{uploaded, extracting, ocr, chunking, embedding}`
12. The document list is refreshed via `GET /api/documents`

### Chat Lifecycle

1. User opens the workspace, a new conversation is auto-created via `POST /api/chat/conversations`
2. User attaches documents to the conversation via `POST /api/chat/conversations/:id/documents`
3. User types a message and clicks send
4. Frontend calls `POST /api/chat/stream` with `{ conversationId, message }` and reads an SSE stream
5. Chat service:
    - Creates conversation if no ID provided
    - Appends user message to the database
    - Retrieves attached documents for the conversation
    - Calls `RetrievalService.retrieve` to search for relevant chunks (scoped to the conversation's documents, not all user documents)
    - Calls `GenerationService.generateFromPrompt` with constructed RAG or fallback prompt
    - Streams response tokens via `GroqProvider.generateStream` SSE
    - After stream completes, persists the assistant message with citations to the database
6. Frontend renders the streaming tokens incrementally, shows sources, and displays the complete conversation

### Search Lifecycle

1. User enters a query in `SearchView`
2. `useSearch` hook sends `POST /api/search` with `{ query, limit }`
3. `SearchService.search`:
    - Embeds the query using the configured embedding provider
    - Runs `SELECT ... FROM chunks ORDER BY embedding <=> $1 LIMIT $2` via the HNSW index
4. Returns matching chunks with similarity scores

---

## Folder Structure

```
/
├── api/                          # Vercel serverless entry point
│   └── index.js                  # Wraps Express app with serverless-http
├── database/
│   ├── schema.sql                # Full schema (documents, chunks, chat_threads, chat_messages, conversation_documents)
│   └── migrations/               # 9 sequential SQL migration files
├── server/
│   ├── index.js                  # Entry point: starts HTTP server, runs startup reconciliation, graceful shutdown
│   ├── app.js                    # Express app factory: wires all dependencies, mounts middleware and routes
│   ├── db.js                     # PostgreSQL Pool singleton and connection verification
│   ├── auth.js                   # Better Auth setup: schema definitions, Drizzle adapter, auth handler, middleware
│   ├── errors.js                 # Error class hierarchy and classifyError utility
│   ├── documents/                # Document ingestion pipeline
│   │   ├── routes.js             # CRUD routes + upload + chunk/embed endpoints
│   │   ├── extractText.js        # File type validation + text extraction (pdf-parse for PDF, UTF-8 for TXT)
│   │   ├── errors.js             # UploadValidationError
│   │   ├── repository.js         # DocumentsRepository: full CRUD, status management, ownership filtering
│   │   ├── documentOrchestrator.js # Pipeline orchestrator: extract -> OCR -> chunk -> embed
│   │   └── reconcileStuckDocuments.js # Startup recovery for stuck processing states
│   ├── generation/               # LLM generation layer
│   │   ├── routes.js             # POST /api/generate
│   │   ├── generationService.js  # RAG routing: retrieve, overlap compute, prompt build, generate
│   │   ├── config.js             # Env-based generation configuration
│   │   ├── promptBuilder.js      # System/user prompt templates for RAG, fallback, and summary modes
│   │   └── GroqProvider.js       # Groq API client (streaming + non-streaming)
│   ├── chat/                     # Conversation chat layer
│   │   ├── routes.js             # Conversation CRUD, message streaming, document attachment
│   │   ├── chatService.js        # Chat orchestration: message handling, streaming, context retrieval
│   │   ├── conversationRepository.js # Chat threads + messages data access
│   │   └── conversationDocumentRepository.js # Junction table operations
│   ├── search/                   # Semantic search layer
│   │   ├── routes.js             # POST /api/search
│   │   ├── searchService.js      # Query embedding + vector search orchestration
│   │   └── searchRepository.js   # pgvector cosine similarity queries
│   ├── retrieval/                # Retrieval layer (conversation-scoped)
│   │   ├── routes.js             # POST /api/retrieval
│   │   └── retrievalService.js   # Thin wrapper over search with conversation-scope filtering
│   ├── ingestion/                # Text chunking
│   │   ├── chunkService.js       # Chunk orchestration
│   │   ├── chunkRepository.js    # Chunk CRUD
│   │   └── chunkText.js          # Text splitting (500-char windows, 100-char overlap)
│   ├── embeddings/               # Vector embedding layer
│   │   ├── embeddingService.js   # Embed orchestration
│   │   ├── embeddingRepository.js # Embedding status + data access
│   │   ├── EmbeddingProvider.js  # Abstract base class
│   │   ├── HuggingFaceProvider.js # HuggingFace Inference API client
│   │   └── LocalTransformersProvider.js # Local transformers (Xenova) embedding
│   ├── storage/                  # File storage abstraction
│   │   ├── provider.js           # Abstract base class
│   │   └── local.js              # Local filesystem storage (uploads/ directory)
│   ├── ocr/                      # OCR pipeline
│   │   ├── ocrService.js         # Sequential queue (max 5, 300s timeout, try/finally lock)
│   │   ├── ocrText.js            # Tesseract.js worker lifecycle (English, sequential pages)
│   │   └── pdfRenderer.js        # pdfjs-dist + @napi-rs/canvas page rendering (2560px max dim)
│   └── http/
│       └── fetchWithRetry.js     # HTTP utility with retry logic
├── web/                          # React frontend
│   ├── src/
│   │   ├── main.jsx              # React entry point (BrowserRouter)
│   │   ├── App.jsx               # Route definitions (/, /login, /signup, /app)
│   │   ├── index.css             # Global styles, Tailwind imports, CSS variables
│   │   ├── api/                  # HTTP client layer
│   │   │   ├── client.js         # Base fetch wrapper (JSON + FormData)
│   │   │   ├── auth.js           # Better Auth client wrapper
│   │   │   └── atlasApi.js       # All API method wrappers (documents, chat, search, etc.)
│   │   ├── hooks/                # React hooks encapsulating API logic
│   │   │   ├── useAuth.js        # Login/signup/logout/session
│   │   │   ├── useChat.js        # Conversations, messages, streaming, document attachment
│   │   │   ├── useDocuments.js   # Document list, poll for processing status, rename, delete
│   │   │   ├── useSearch.js      # Semantic search
│   │   │   ├── useGenerate.js    # Standalone generation
│   │   │   └── useUpload.js      # File upload
│   │   ├── components/           # Reusable UI components
│   │   │   ├── ChatTranscript.jsx
│   │   │   ├── ConversationItem.jsx
│   │   │   ├── ConversationList.jsx
│   │   │   ├── DocumentAttachModal.jsx
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── GuestRoute.jsx
│   │   │   ├── Navbar.jsx
│   │   │   ├── Panel.jsx
│   │   │   ├── ProtectedRoute.jsx
│   │   │   ├── SearchView.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── SourcesList.jsx
│   │   └── pages/                # Page-level components
│   │       ├── LandingPage.jsx
│   │       ├── LoginPage.jsx
│   │       ├── SignupPage.jsx
│   │       └── WorkspacePage.jsx
│   └── vite.config.js            # Vite config with API proxy
├── uploads/                      # Uploaded files (gitignored)
├── package.json                  # Monorepo-style scripts (concurrently runs web + api)
├── tailwind.config.cjs           # Tailwind config with Atlas design tokens
├── vercel.json                   # Vercel SPA deployment config
└── eng.traineddata               # Tesseract language data (gitignored)
```

---

## Database Architecture

**Engine:** PostgreSQL 16+ with pgvector extension (Neon serverless)

**Schema:** `public` schema for application tables, `better_auth` schema for authentication tables

### Tables

**`documents`** — Core document entity.
- `id` (uuid PK, gen_random_uuid)
- `user_id` (text, nullable FK to better_auth.user)
- `file_name`, `file_type` (pdf|txt), `file_size_bytes`, `storage_path`, `extracted_text` (text), `source_type` (upload)
- `status` — constrained to: `uploaded`, `extracting`, `ocr`, `chunking`, `embedding`, `ready`, `failed`
- `progress` (integer 0-100), `failure_reason`, `ocr_quality` (double precision)
- `processing_started_at`, `ready_at`, `failed_at` (timestamptz)
- `created_at`, `updated_at` (timestamptz, auto)
- Indexed on `status`, `(user_id, created_at DESC)`

**`chunks`** — Text chunks with vector embeddings.
- `id` (uuid PK), `document_id` (uuid FK -> documents ON DELETE CASCADE)
- `chunk_index`, `content` (text), `character_count`
- `embedding` (vector(384)) — HNSW index with cosine distance
- `UNIQUE(document_id, chunk_index)`
- Indexed on `document_id`, `created_at DESC`

**`chat_threads`** — Conversation threads.
- `id` (uuid PK), `user_id` (text, nullable)
- `title` (text, default 'Untitled thread')
- `created_at`, `updated_at`

**`chat_messages`** — Messages within conversations.
- `id` (uuid PK), `thread_id` (uuid FK -> chat_threads ON DELETE CASCADE)
- `role` (text, CHECK: user|assistant|system), `content` (text)
- `citations` (jsonb, default '[]')
- `model`, `prompt_tokens`, `completion_tokens`
- Indexed on `(thread_id, created_at DESC)`

**`conversation_documents`** — Junction table attaching documents to conversations.
- `conversation_id` (uuid FK -> chat_threads), `document_id` (uuid FK -> documents)
- `PRIMARY KEY(conversation_id, document_id)`
- Indexed on both columns

**Better Auth tables** (in `better_auth` schema):
- `user` — id, name, email, email_verified, image, timestamps
- `session` — id, expires_at, token, ip_address, user_agent, userId (FK -> user)
- `account` — id, accountId, providerId, userId (FK -> user), tokens, password
- `verification` — id, identifier, value, expires_at

### Migration Strategy

Migrations are sequential SQL files in `database/migrations/` prefixed with `YYYYMMDD`. There is no migration runner — migrations are applied manually. The current `schema.sql` represents the desired end state and includes `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency.

Key migrations:
- `20260530_create_chunks_table.sql` — initial chunks table with vector column
- `20260530_add_embedding_column_to_chunks.sql` — adds vector(384) column
- `20260530_harden_chunks_table.sql` — adds unique constraint, HNSW index
- `20260531_add_document_lifecycle_columns.sql` — adds status/progress/lifecycle columns
- `20260601_create_better_auth_schema.sql` — auth schema and tables
- `20260601_add_ownership_columns.sql` — adds user_id to documents and chat_threads
- `20260617_create_conversation_documents_table.sql` — junction table
- `20260617_add_ocr_status.sql` — adds 'ocr' to status CHECK constraint
- `20260619_add_ocr_quality.sql` — adds ocr_quality column

---

## API Architecture

All API routes are under `/api/*`. The Express app mounts middleware in this order:

1. `helmet()` — security headers
2. `cookieParser()` — parse cookies for session tokens
3. `cors()` — configured with `WEB_ORIGIN` and `credentials: true`
4. `morgan()` — request logging
5. `authLimiter` — rate limiter (10 POST/15min) specifically for `/api/auth/sign-in/email` and `/api/auth/sign-up/email`
6. `authHandler` — proxies `/api/auth/*` to Better Auth
7. `apiLimiter` — rate limiter (200 req/15min) for all other `/api/*` routes
8. `express.json({ limit: '2mb' })`
9. `authMiddleware` — reads session cookie/token, populates `req.user` (non-blocking)

The auth limiter is mounted separately from the general API limiter so credential endpoints have a tighter throttle.

### Route Map

| Method | Path | Module | Auth |
|--------|------|--------|------|
| ALL | `/api/auth/*` | `auth.js` | Handled by Better Auth |
| GET | `/api/health` | `app.js` | None |
| GET | `/api/health/db` | `app.js` | None |
| GET | `/api/status` | `app.js` | None |
| GET | `/api/documents` | `documents/routes.js` | Required (401 if absent) |
| GET | `/api/documents/:id` | `documents/routes.js` | Required |
| POST | `/api/documents/upload` | `documents/routes.js` | Required |
| PATCH | `/api/documents/:id` | `documents/routes.js` | Required |
| DELETE | `/api/documents/:id` | `documents/routes.js` | Required |
| POST | `/api/documents/:id/chunk` | `documents/routes.js` | Required |
| GET | `/api/documents/:id/chunks` | `documents/routes.js` | Required |
| POST | `/api/documents/:id/embed` | `documents/routes.js` | Required |
| GET | `/api/documents/:id/embeddings/status` | `documents/routes.js` | Required |
| GET | `/api/documents/:id/status` | `documents/routes.js` | Required |
| POST | `/api/search` | `search/routes.js` | Required |
| POST | `/api/retrieval` | `retrieval/routes.js` | Required |
| POST | `/api/generate` | `generation/routes.js` | Required |
| POST | `/api/chat` | `chat/routes.js` | Required |
| POST | `/api/chat/stream` | `chat/routes.js` | Required |
| POST | `/api/chat/conversations` | `chat/routes.js` | Required |
| GET | `/api/chat/conversations` | `chat/routes.js` | Required |
| GET | `/api/chat/conversations/:id/messages` | `chat/routes.js` | Required |
| PATCH | `/api/chat/conversations/:id` | `chat/routes.js` | Required |
| DELETE | `/api/chat/conversations/:id` | `chat/routes.js` | Required |
| GET | `/api/chat/conversations/:id/documents` | `chat/routes.js` | Required |
| POST | `/api/chat/conversations/:id/documents` | `chat/routes.js` | Required |
| DELETE | `/api/chat/conversations/:id/documents/:documentId` | `chat/routes.js` | Required |

All authenticated endpoints check `request.user?.id` and return 401 if absent. Ownership is enforced at the repository level with `ForUser` method variants that include `WHERE user_id = $2` in SQL.

### Error Response Format

All errors follow a consistent shape:
```json
{
  "error": "error_code",
  "category": "validation|provider|database|internal",
  "message": "Human-readable description"
}
```

### SSE Stream Format (Chat)

The streaming chat endpoint (`POST /api/chat/stream`) returns `text/event-stream`:
```
data: {"type":"meta","conversationId":"...","model":"...","userMessageId":"..."}
data: {"type":"sources","sources":[...]}
data: {"type":"token","text":"..."}
data: {"type":"done"}
```

Heartbeats are sent every 15 seconds as `data: {"type":"ping"}`.

---

## Authentication Flow

Atlas uses Better Auth for email/password authentication.

### Flow

1. User navigates to `/login` or `/signup`
2. Frontend uses `better-auth/react` client to call the auth API
3. The request hits Better Auth's handler at `/api/auth/*`
4. Better Auth validates credentials, creates user/session, sets an httpOnly cookie
5. Frontend calls `getSession()` to verify and get user data
6. All subsequent API requests include `credentials: 'include'` in fetch
7. `authMiddleware` on the server reads the session cookie via `fromNodeHeaders`, calls `auth.api.getSession`, and populates `req.user` and `req.session`
8. The middleware is permissive — if no session is found, `req.user` is null and the request continues. Each route handler decides whether to reject unauthenticated requests.

### Session Management

- Sessions are stored in the `better_auth.session` table
- Cookie name defaults to `ba_session` (configurable via `COOKIE_NAME`)
- Cookie is httpOnly, sameSite: 'lax' (overridden to 'none' with secure:true in production)
- `BETTER_AUTH_URL` env var sets the base URL for the auth server
- `BETTER_AUTH_SECRET` (or `AUTH_SECRET`) is used to sign session tokens

### Auth Tables

Better Auth manages its own schema (`better_auth`) with four tables: `user`, `session`, `account`, `verification`. The Drizzle ORM adapter bridges Better Auth to PostgreSQL.

---

## Deployment Architecture

### Frontend (Vercel)

- Built via `npm run build:web` which runs `vite build`
- Output directory is `web/dist`
- `vercel.json` rewrites all routes to `index.html` for SPA routing
- Environment variables are configured in Vercel project settings

### Backend (Railway)

- Started via `npm start` which runs `node server/index.js`
- Port is configured via `PORT` env var (default 8787)
- Environment variables required at startup (validated in `app.js`):
  - `DATABASE_URL` — Neon PostgreSQL connection string
  - `GROQ_API_KEY` — Groq API key
  - Optional: `HF_API_KEY`, `EMBEDDING_PROVIDER`, `GROQ_MODEL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `WEB_ORIGIN`, `MAX_OCR_FILE_SIZE_MB`, `GENERATION_TOP_K`, `GENERATION_SIMILARITY_THRESHOLD`, etc.
- Uploaded files are stored on local disk under `uploads/`
- Tesseract language data is cached to disk (persists per-deployment)
- The server handles `SIGTERM` and `SIGINT` for graceful shutdown with a 10-second timeout

### Serverless Fallback

- `api/index.js` wraps the Express app with `serverless-http` for Vercel serverless function deployment
- When deployed as serverless, the entire Express app runs per-request inside a Vercel function

---

## External Services

| Service | Purpose | Integration Point |
|---------|---------|------------------|
| **Neon PostgreSQL** | Primary database with pgvector extension | `server/db.js` — Pool connection via `DATABASE_URL` |
| **Groq** | LLM provider for chat generation and standalone Q&A | `server/generation/GroqProvider.js` — REST API at `https://api.groq.com/openai/v1` |
| **HuggingFace Inference API** | Embedding provider (default) | `server/embeddings/HuggingFaceProvider.js` — model `BAAI/bge-small-en-v1.5` |
| **Better Auth** (self-hosted) | Authentication provider | `server/auth.js` — bundled as a library, not an external service; runs in-process |

The system does not use Redis, message queues, blob storage, CDNs, monitoring services, or external search engines.

---

## Technology Choices

All explanations are based on evidence found in the codebase:

- **Node.js + Express.js** — The project uses a JavaScript-first approach (no TypeScript). Express is the de-facto Node.js web framework. The README explicitly states "The codebase is now JavaScript-first, so there is no TypeScript check step in this scaffold."

- **React + Vite** — Frontend is built with React 19 (from package.json dependency). Vite is used as the build tool and dev server with HMR. The vite.config.js proxies `/api` to the Express backend during development.

- **TailwindCSS** — Used for styling with a custom design system defined in `tailwind.config.cjs` (colors: atlas-ink, atlas-mist, atlas-teal, atlas-sky, atlas-gold; custom shadow: glow). The CSS imports Tailwind layers at the base level.

- **Neon PostgreSQL + pgvector** — The database is PostgreSQL with the pgvector extension for vector similarity search. Connection is via a connection pool in `server/db.js`. The `vectors` extension is enabled in `schema.sql` and vector(384) columns power semantic search via an HNSW index with cosine distance.

- **Groq** — The sole LLM provider for chat generation. The `GroqProvider.js` implements both synchronous generation and SSE streaming. Model name is configurable via `GROQ_MODEL` env var (default `openai/gpt-oss-20b`, overridden to `openai/gpt-oss-20b` in the current .env).

- **Better Auth** — Chosen for authentication with email/password. Integrated via Drizzle ORM adapter for PostgreSQL. The setup creates its own schema (`better_auth`) separate from the application schema.

- **pgvector HNSW index** — The `chunks_embedding_hnsw_idx` index on the `embedding` column uses `hnsw` with `vector_cosine_ops` for approximate nearest neighbor search at query time.

- **pdf-parse** — Used for text extraction from PDFs via `extractText.js`. This is the primary extraction path; OCR is a fallback.

- **tesseract.js** — OCR engine for scanned PDFs. Already a dependency before OCR was implemented (mentioned in `OCR_ARCHITECTURE.md` as already in package.json). Used via WebAssembly with no native dependencies.

- **pdfjs-dist + @napi-rs/canvas** — PDF page rendering for OCR input. pdfjs-dist renders PDF pages to canvas, @napi-rs/canvas provides the canvas implementation and PNG buffer output. Chosen over node-canvas to avoid native build dependencies (documented in `OCR_ARCHITECTURE.md`).

- **Multer** — HTTP file upload parsing with memory storage and 25MB size limit.

- **Helmet, CORS, Morgan, express-rate-limit** — Standard Express security and operational middleware: security headers, CORS configuration, request logging, and API-wide rate limiting.

- **Drizzle ORM** — Used only for Better Auth integration (the Drizzle adapter). The application data access layer uses raw SQL queries via `pg` Pool directly, not through an ORM.

- **serverless-http** — Wraps the Express app for Vercel serverless function compatibility in `api/index.js`.

- **concurrently** — Dev script runner that starts the Vite dev server and Express API simultaneously.

- **Zod** — Listed in package.json dependencies but not observed in the code as being actively used. Possibly intended for future validation.

---

## Future Architecture Considerations

The following extension points are visible in the codebase:

1. **Multi-provider embedding support** — The `EmbeddingProvider` base class (`server/embeddings/EmbeddingProvider.js`) defines an abstract interface. Two implementations exist: `HuggingFaceProvider` and `LocalTransformersProvider`. The provider is selected at startup via `EMBEDDING_PROVIDER` env var. A third provider (e.g., OpenAI, Cohere) can be added by implementing the same interface and adding a branch in `app.js`.

2. **Multi-provider generation support** — The `GroqProvider` exposes `generate` and `generateStream` methods. The `GenerationProvider` base class (`server/generation/GenerationProvider.js`) defines this interface. A new provider (e.g., OpenAI, Anthropic) can be added by implementing the same interface.

3. **Storage provider abstraction** — The `StorageProvider` base class (`server/storage/provider.js`) defines `saveFile`, `ensureReady`, `deleteFile`. Currently only `LocalStorageProvider` is implemented. A cloud storage provider (S3, R2, GCS) can be added without changing the rest of the system.

4. **Ownership enforcement** — The `documents` and `chat_threads` tables have `user_id` columns that are currently nullable. Repository methods have `ForUser` variants (e.g., `getDocumentByIdForUser`, `listDocumentsForUser`), but the document orchestrator's `processDocument` uses the non-ForUser variant. The SYSTEM_AUDIT.md notes this as a pre-existing concern. The columns and query patterns are in place to enable full tenant isolation.

5. **Language configuration for OCR** — OCR is hardcoded to English only. The `OCR_OPERATIONAL_RESILIENCE.md` mentions a future `OCR_LANGUAGE` env var and per-document language override as planned additions.

6. **Periodic reconciliation** — The current reconciliation runs only at startup. The `OCR_OPERATIONAL_RESILIENCE.md` mentions adding periodic (5-minute) reconciliation as a future enhancement if stuck documents become a support issue.

7. **RAG threshold configuration** — The RAG routing decision uses hardcoded thresholds (`topSimilarity >= 0.50 && overlapCount >= 1`). The SYSTEM_AUDIT.md recommends making these configurable or unified with the retrieval similarity threshold.

8. **Standalone `/api/generate`** — Exists alongside the chat system, sharing the same generation and retrieval services. This is a documented future integration point for question-answering without conversation context.

9. **Chunking strategy** — Current chunking uses fixed 500-character windows with 100-character overlap. The SYSTEM_AUDIT.md notes this as "acceptable for v1 but produces awkward chunk boundaries," implying sentence/paragraph-aware chunking is a future improvement path.
