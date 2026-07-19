# Atlas

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20.0+-brightgreen)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker)](docker-compose.yml)

> A production-grade, multi-tenant Retrieval-Augmented Generation (RAG) platform for intelligent document conversations.

Upload PDF and TXT documents, perform semantic search using vector embeddings, and interact with your knowledge base through citation-aware AI conversations. Built for production from day one — not a prototype.

---

## Motivation

Modern LLMs are powerful but lack access to private knowledge. Atlas bridges this gap by letting you upload your documents, index them as vector embeddings, and ask questions that are grounded in your data. Every answer cites its source chunks, so you can verify the response.

Built with a monolith-first architecture — one backend, one database, one deployment. No microservice complexity, no message queues, no infrastructure tax.

---

## Features

- Document ingestion for PDF and TXT files
- Automatic text extraction with OCR fallback for scanned PDFs
- Recursive chunking with configurable overlap
- Vector embedding generation via HuggingFace Inference API
- Semantic search powered by PostgreSQL + pgvector (HNSW index)
- Citation-aware AI conversations with source attribution
- Streaming responses via Server-Sent Events
- Conversation history with document attachment
- Multi-user authentication with session management
- Error classification and rate limiting
- Graceful shutdown and startup reconciliation
- Docker deployment with multi-stage builds

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6, TailwindCSS |
| Backend | Node.js 20, Express 4 |
| Database | PostgreSQL 16 + pgvector |
| Authentication | Better Auth (email/password) |
| Embeddings | HuggingFace Inference API (`BAAI/bge-small-en-v1.5`) |
| LLM | Groq (`llama-3.1-70b-versatile`) |
| OCR | pdfjs-dist + @napi-rs/canvas + tesseract.js |
| Deployment | Frontend: Vercel / Backend: Render / DB: Neon |
| Containerization | Docker (multi-stage, docker-compose) |

---

## Architecture

```
                  ┌─────────────┐
                  │   Browser   │
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │    Nginx    │  (or Vite dev proxy)
                  │  /api/* →   │
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │   Express   │
                  │    Server   │
                  └──┬───┬───┬──┘
                     │   │   │
          ┌──────────┘   │   └──────────┐
          ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │  Better  │   │  Groq    │   │  Hugging │
   │   Auth   │   │   LLM    │   │   Face   │
   └──────────┘   └──────────┘   └──────────┘
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                  ┌──────────────┐
                  │  PostgreSQL  │
                  │  + pgvector  │
                  └──────────────┘
```

### RAG Pipeline

```
Upload → Extract → [OCR] → Chunk → Embed → pgvector
                                                │
Query → Embed → Cosine Search → Context → LLM → Response + Citations
```

---

## Project Structure

```
atlas/
├── server/                    # Express backend
│   ├── app.js                 # Dependency wiring, middleware, routes
│   ├── index.js               # HTTP server entry + graceful shutdown
│   ├── auth.js                # Better Auth configuration
│   ├── db.js                  # PostgreSQL connection pool
│   ├── errors.js              # Error class hierarchy + classification
│   ├── chat/                  # Conversations, messages, SSE streaming
│   │   ├── routes.js
│   │   ├── chatService.js
│   │   ├── conversationRepository.js
│   │   └── conversationDocumentRepository.js
│   ├── documents/             # Upload, extraction, lifecycle orchestration
│   │   ├── routes.js
│   │   ├── repository.js
│   │   ├── documentOrchestrator.js
│   │   └── extractText.js
│   ├── embeddings/            # Embedding provider abstraction
│   │   ├── embeddingService.js
│   │   ├── HuggingFaceProvider.js
│   │   └── EmbeddingProvider.js
│   ├── generation/            # LLM provider, prompt building
│   │   ├── GroqProvider.js
│   │   ├── generationService.js
│   │   ├── promptBuilder.js
│   │   └── config.js
│   ├── ingestion/             # Text chunking
│   │   ├── chunkService.js
│   │   └── chunkRepository.js
│   ├── search/                # pgvector semantic search
│   │   ├── searchService.js
│   │   └── searchRepository.js
│   ├── retrieval/             # Conversation-scoped retrieval
│   │   ├── retrievalService.js
│   │   └── routes.js
│   ├── storage/               # File storage abstraction
│   │   ├── provider.js
│   │   └── local.js
│   ├── ocr/                   # PDF rendering + Tesseract OCR
│   │   ├── ocrService.js
│   │   ├── ocrText.js
│   │   └── pdfRenderer.js
│   └── http/                  # HTTP utility
│       └── fetchWithRetry.js
├── web/                       # React frontend
│   ├── src/
│   │   ├── api/               # HTTP client wrappers
│   │   ├── hooks/             # useAuth, useChat, useDocuments, etc.
│   │   ├── components/        # Reusable UI components
│   │   └── pages/             # Landing, Login, Signup, Workspace
│   ├── vite.config.js
│   └── index.html
├── database/                  # PostgreSQL schema and migrations
│   ├── schema.sql
│   └── migrations/
├── api/                       # Vercel serverless entry point
│   └── index.js
├── docker/                    # Docker infrastructure
│   └── nginx.conf
├── Dockerfile                 # Multi-stage production build
├── Dockerfile.dev             # Development with hot-reload
├── docker-compose.yml         # Production orchestration
├── docker-compose.dev.yml     # Development orchestration
├── .env.example               # Documented environment variables
├── Makefile                   # Convenience commands
├── .dockerignore
└── package.json               # Monorepo dependencies
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ with pgvector extension (or [Neon](https://neon.tech) serverless)
- A [Groq API key](https://console.groq.com/keys)
- A [HuggingFace API key](https://huggingface.co/settings/tokens) (for embeddings)

### Local Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/atlas.git
cd atlas

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start development servers (frontend + backend)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Docker Setup

```bash
# Start all services (PostgreSQL, backend, frontend)
docker compose up --build -d

# Or use the Makefile
make docker-start

# Open http://localhost:80
```

For development with hot-reload:

```bash
docker compose -f docker-compose.dev.yml up --build -d
# Or: make docker-dev-start
```

See the [Makefile](Makefile) for all available commands:
- `make dev` — Local development
- `make docker-start` — Docker production
- `make docker-dev-start` — Docker development with hot-reload
- `make docker-logs` — Follow logs
- `make docker-clean` — Full teardown

---

## Environment Variables

See [`.env.example`](.env.example) for a complete list. Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (with pgvector) |
| `GROQ_API_KEY` | Groq API key for LLM generation |
| `BETTER_AUTH_SECRET` | Session signing secret (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | Auth server base URL |
| `WEB_ORIGIN` | Frontend URL for CORS (default: `http://localhost:5173`) |
| `HF_API_KEY` | HuggingFace API key for embeddings |

---

## Screenshots

> Screenshots coming soon. Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## API Overview

All API routes are under `/api/*`. The server exposes the following endpoints:

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/api/auth/*` | Authentication (handled by Better Auth) |
| GET | `/api/health` | Health check |
| GET | `/api/health/db` | Database connectivity check |
| GET | `/api/documents` | List user documents |
| POST | `/api/documents/upload` | Upload a document |
| GET | `/api/documents/:id` | Get document details |
| DELETE | `/api/documents/:id` | Delete a document |
| POST | `/api/search` | Semantic search |
| POST | `/api/retrieval` | Conversation-scoped retrieval |
| POST | `/api/generate` | Generate with RAG context |
| POST | `/api/chat` | Send chat message |
| POST | `/api/chat/stream` | Stream chat via SSE |
| GET | `/api/chat/conversations` | List conversations |
| POST | `/api/chat/conversations` | Create conversation |

All authenticated endpoints require a valid session cookie. Errors follow a consistent JSON format:

```json
{
  "error": "error_code",
  "category": "validation | provider | database | internal",
  "message": "Human-readable description"
}
```

---

## Deployment

### Frontend (Vercel)

```bash
npm run build:web
# Deploy web/dist/ to Vercel
```

### Backend (Render / Railway)

```bash
npm start
# Requires DATABASE_URL and GROQ_API_KEY at minimum
```

### Docker (Any container host)

```bash
docker compose up --build -d
```

---

## Roadmap

- [x] Multi-user authentication
- [x] PDF and TXT document ingestion
- [x] OCR for scanned PDFs
- [x] Semantic retrieval with pgvector
- [x] Citation-aware chat with streaming
- [x] Docker deployment
- [ ] Hybrid search (BM25 + vector)
- [ ] Cross-encoder re-ranking
- [ ] Document collections and sharing
- [ ] Retrieval evaluation dashboard
- [ ] Admin panel and usage metrics

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup guide
- Coding standards
- Commit conventions
- Pull request process

---

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

---

## Credits

- [Groq](https://groq.com) for LLM inference
- [HuggingFace](https://huggingface.co) for embedding models
- [Neon](https://neon.tech) for serverless PostgreSQL
- [Better Auth](https://better-auth.com) for authentication
- [pgvector](https://github.com/pgvector/pgvector) for vector search
- All [open-source dependencies](package.json)
