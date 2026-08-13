# Setup

## Prerequisites

- **Node.js** 18+ (the project uses ESM `"type": "module"` in package.json)
- **npm** 9+
- **PostgreSQL** 16+ with the **pgvector** extension — or a [Neon](https://neon.tech) serverless PostgreSQL account (the database URL in `.env` uses Neon)

---

## Installation

```bash
git clone <repo-url>
cd atlas
npm install
```

This installs all dependencies in a single `node_modules/` at the project root. The frontend (React, Vite, TailwindCSS) and backend (Express, pg, tesseract.js, pdfjs-dist) dependencies are combined in one `package.json`.

---

## Environment Variables

Copy the existing `.env` file (committed to the repo with example values) and replace the secrets:

```bash
cp .env .env.local
```

Then edit `.env.local` with your own credentials.

### Required

| Variable | Source | Description |
|----------|--------|-------------|
| `DATABASE_URL` | `server/db.js:12`, `server/auth.js:73` | PostgreSQL connection string with pgvector support. Validated at startup — the server exits if missing. |
| `GROQ_API_KEY` | `server/generation/config.js:24`, `server/app.js:15` | Groq API key for LLM chat generation. Validated at startup — the server exits if missing. |

### Authentication

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `BETTER_AUTH_SECRET` | `server/auth.js:90` | (falls back to `AUTH_SECRET`) | Secret key for signing auth session tokens. Generate via `openssl rand -hex 32`. |
| `BETTER_AUTH_URL` | `server/auth.js:85` | `http://localhost:8787` | Base URL of the auth server. Must match the deployed origin in production, otherwise cookies/redirects will break. |
| `WEB_ORIGIN` | `server/auth.js:86`, `server/app.js:115` | `http://localhost:5173` | Allowed CORS origin. Must match the frontend URL. Also used as Better Auth trusted origin. |

### LLM Generation

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `GROQ_MODEL` | `server/generation/config.js:25` | `openai/gpt-oss-20b` | Groq model ID for chat. Current `.env` overrides to `openai/gpt-oss-20b`. |
| `GROQ_BASE_URL` | `server/generation/config.js:26` | `https://api.groq.com/openai/v1` | Groq API base URL. Change for proxy or self-hosted endpoints. |
| `GROQ_TEMPERATURE` | `server/generation/config.js:29` | `0` | LLM temperature (0-2). |
| `GROQ_MAX_TOKENS` | `server/generation/config.js:30` | `512` | Maximum tokens per generation. |
| `GENERATION_TOP_K` | `server/generation/config.js:27` | `6` | Number of chunks to retrieve for RAG context. |
| `GENERATION_SIMILARITY_THRESHOLD` | `server/generation/config.js:28` | `0.5` | Minimum cosine similarity for chunk retrieval. |
| `GENERATION_PROVIDER` | `server/generation/config.js:23` | `groq` | Provider name. Only `groq` is implemented; used for future multi-provider support. |

### Embeddings

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `EMBEDDING_PROVIDER` | `server/app.js:62` | `huggingface` | Embedding provider: `huggingface` (HuggingFace Inference API) or `local`/`local-transformers` (stub — not implemented). |
| `HF_API_KEY` | `server/app.js:67` | (optional if not using HuggingFace) | HuggingFace Inference API key. Required when `EMBEDDING_PROVIDER=huggingface`. |

### OCR

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `MAX_OCR_FILE_SIZE_MB` | `server/documents/documentOrchestrator.js:7` | `15` | Maximum file size in MB for OCR processing. Files larger than this skip OCR and fail with a message. |

### Server

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `PORT` | `server/index.js:13` | `8787` | HTTP server port. |
| `NODE_ENV` | `server/app.js:119`, `server/chat/chatService.js:367` | (none) | Set to `production` to enable combined request logging and suppress dev-only debug output. |

### Frontend (Vite)

These are prefixed with `VITE_` and embedded at build time. Set them in a `.env` file at the project root or in the Vercel dashboard.

| Variable | Source | Default | Description |
|----------|--------|---------|-------------|
| `VITE_API_BASE_URL` | `web/src/api/client.js:1`, `web/src/api/auth.js:3` | `''` (empty = same origin) | Backend API base URL. In dev, the Vite proxy handles `/api/*` so this can be empty. In production, set to your deployed API origin (e.g. `https://atlas-api.railway.app`). |
| `VITE_AUTH_URL` | `web/src/api/auth.js:3` | fallback to `VITE_API_BASE_URL` | Explicit auth endpoint URL if different from the API base. |

---

## Running Locally

### Development Mode (both layers)

```bash
npm run dev
```

This runs both servers concurrently via `concurrently`:
- **Frontend** (Vite dev server): `http://localhost:5173`
- **Backend** (Express with `--watch` for auto-reload): `http://localhost:8787`

The Vite dev server proxies all `/api/*` requests to `http://localhost:8787` (configured in `web/vite.config.js`).

### Frontend Only

```bash
npm run dev:web
```

Starts the Vite dev server at `http://localhost:5173`. The backend must be running separately.

### Backend Only

```bash
npm run dev:api
```

Starts the Express server at `http://localhost:8787` with file watching via `node --watch`.

### Standalone API (no frontend)

```bash
npm start
```

Starts the Express server in production mode.

### Lint

```bash
npm run lint
```

Currently a placeholder that prints: `"Linting will be added after the first slice lands."`

---

## Build

```bash
npm run build
```

This builds only the frontend (Vite compiles `web/` to `web/dist/`). There is no backend build step — the Express server runs directly from source `.js` files.

The Vercel configuration in `vercel.json` sets:
- Build command: `npm run build:web`
- Output directory: `web/dist`
- All routes rewritten to `index.html` for SPA routing

---

## Deployment

### Frontend — Vercel

1. Connect the repository to Vercel
2. Set these environment variables in the Vercel dashboard:
   - `VITE_API_BASE_URL` — the URL of your deployed API (e.g. Railway app URL)
3. Vercel detects the `vercel.json` configuration automatically
4. Deploy — Vercel runs `npm run build:web` and serves `web/dist`

### Backend — Railway

1. Connect the repository to Railway
2. Set the start command: `npm start`
3. Set all required environment variables in the Railway dashboard:
   - `DATABASE_URL`, `GROQ_API_KEY`, `BETTER_AUTH_SECRET` (required)
   - `BETTER_AUTH_URL` — must be set to the Railway app URL (defaults to `localhost:8787` otherwise)
   - `WEB_ORIGIN` — must match the Vercel frontend URL
   - `HF_API_KEY`, `EMBEDDING_PROVIDER` — for embedding service
   - `GROQ_MODEL`, `GROQ_TEMPERATURE`, etc. — optional overrides
4. Deploy

### Serverless (Vercel Functions)

The `api/index.js` file wraps the Express app with `serverless-http`, enabling the API to run as a Vercel serverless function. This is an alternative to Railway. Note that long-running OCR tasks may hit Vercel's function timeout (10s on Hobby, 60s on Pro, 900s on Enterprise).

---

## Folder Overview

```
atlas/
├── api/                          # Vercel serverless entry point
│   └── index.js                  # Wraps Express app with serverless-http
├── database/
│   ├── schema.sql                # Full schema (6 tables, 2 schemas)
│   └── migrations/               # 9 sequential SQL migration files
├── server/
│   ├── index.js                  # HTTP server entry, startup reconciliation, graceful shutdown
│   ├── app.js                    # Express app factory — wires all dependencies and routes
│   ├── db.js                     # PostgreSQL Pool singleton
│   ├── auth.js                   # Better Auth schema, handler, middleware
│   ├── errors.js                 # Error class hierarchy + classifyError utility
│   ├── documents/                # Document upload, ingestion pipeline, repository
│   ├── generation/               # LLM config, Groq provider, prompt builder, generation service
│   ├── chat/                     # Conversations, messages, SSE streaming, document attachment
│   ├── search/                   # Semantic search with pgvector
│   ├── retrieval/                # Conversation-scoped retrieval wrapper
│   ├── ingestion/                # Text chunking (500-char windows, 100-char overlap)
│   ├── embeddings/               # Embedding provider abstraction, HuggingFace, local stub
│   ├── storage/                  # File storage abstraction, local filesystem implementation
│   ├── ocr/                      # PDF rendering, tesseract.js, sequential OCR queue
│   └── http/                     # fetchWithRetry utility
├── web/                          # React frontend
│   └── src/
│       ├── App.jsx               # Route definitions
│       ├── main.jsx              # Entry point (BrowserRouter)
│       ├── index.css             # Tailwind imports, design tokens, global styles
│       ├── api/                  # HTTP client, auth client, all API method wrappers
│       ├── hooks/                # useAuth, useChat, useDocuments, useSearch, etc.
│       ├── components/           # Reusable UI components
│       └── pages/                # LandingPage, LoginPage, SignupPage, WorkspacePage
├── uploads/                      # Uploaded files (gitignored)
├── eng.traineddata               # Tesseract language data (gitignored)
├── package.json                  # Root package.json with all dependencies and scripts
├── tailwind.config.cjs           # TailwindCSS configuration with Atlas design tokens
├── vite.config.js                # Vite configuration with API proxy and React plugin
└── vercel.json                   # Vercel static deployment configuration
```

---

## Troubleshooting

### Server exits immediately with "FATAL: Missing required environment variable"

The server validates two variables at startup in `server/app.js:13-16`:
- `DATABASE_URL`
- `GROQ_API_KEY`

If either is missing, the process exits with code 1. Ensure both are set in your environment or `.env` file.

### "DATABASE_URL is not configured" when uploading documents

The application uses a lazy-initialized connection pool (`server/db.js`). If `DATABASE_URL` is not set, `getPool()` returns `null` and all database operations throw this error. Set `DATABASE_URL` and restart.

### Chat returns "insufficient context" for every query

The LLM is instructed to answer using only the retrieved document context. If no chunks pass the similarity threshold (default 0.50) or term overlap gate (overlapCount >= 1), the fallback mode answers from general knowledge. If both modes fail, check:
- Documents are fully processed (status = `ready`)
- Documents are attached to the conversation
- The embedding provider (HuggingFace) API key is valid and the service is reachable
- `EMBEDDING_PROVIDER` is not set to `local` or `local-transformers` (these are not implemented)

### Uploaded PDF shows "Processing..." forever

The frontend polls for status changes every 2 seconds, backing off to 10 seconds, with a 10-minute timeout. If a document stays in a processing state past the timeout:
1. Check the server logs for OCR errors (`[OCR]`-prefixed lines)
2. If the server was restarted during processing, the document may be stuck. The startup reconciliation (`reconcileStuckDocuments`) automatically fails documents stuck for >30 minutes on next restart. If the server has not been restarted, restart it.
3. Delete and re-upload the document.

### OCR fails with "This scanned PDF is too large for OCR"

The default OCR file size limit is 15MB. Files larger than this skip OCR and fail. Either:
- Reduce the PDF file size before uploading
- Increase the limit via `MAX_OCR_FILE_SIZE_MB` environment variable (e.g. `MAX_OCR_FILE_SIZE_MB=25`)

### Auth cookies not working

Authentication uses httpOnly cookies with `sameSite: "none"` and `secure: true`. In local development over HTTP, cookies may not be sent correctly:
- Ensure `WEB_ORIGIN=http://localhost:5173` is set
- Ensure `BETTER_AUTH_URL=http://localhost:8787` is set
- If using a custom domain or HTTPS in dev, update both values
- The production setup requires HTTPS for `sameSite: "none"` to work

### "LocalTransformersProvider is not implemented yet"

The `EMBEDDING_PROVIDER` env var is set to `local` or `local-transformers`. Both are stubs that throw "not implemented yet." Set `EMBEDDING_PROVIDER=huggingface` and provide a valid `HF_API_KEY`.

### Streaming chat stops after a few tokens

The SSE streaming endpoint has a 15-second heartbeat to keep the connection alive. If the connection drops mid-stream:
- Check for proxy/gateway timeouts (Railway Hobby has a 30s request timeout, but the POST response is sent before ingestion starts — exceptions exist for long generations)
- The request timeout for Groq's streaming endpoint is not covered by `fetchWithRetry` (the streaming path uses `fetch()` directly, not the retry wrapper)
- Retry the message — mid-stream failures do not persist partial responses

### Frontend shows 401 on all API requests

The `authMiddleware` is permissive (it does not reject unauthenticated requests), but individual route handlers call `requireAuthenticatedUser()` which returns 401 if `request.user?.id` is falsy. If you are getting 401s:
- Check that you are logged in (the session cookie is present)
- Check that the cookie is being sent (`credentials: 'include'` in fetch)
- Check that `VITE_API_BASE_URL` is set correctly — CORS misconfiguration can cause cookies to be dropped
