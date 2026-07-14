# Changelog

## [Unreleased]

### Added
- Portfolio metadata, documentation placeholder files, asset placeholders, changelog, and license ([a330ce2](https://github.com/Deep084-bot/atlas-rag-platform/commit/a330ce2))

## [v1.3.1] — 2026-06-20

### Fixed
- Route stream endpoint through API client ([44ed50a](https://github.com/Deep084-bot/atlas-rag-platform/commit/44ed50a))

## [v1.3.0] — 2026-06-19

### Added
- Production start script (`npm start`) ([e4779ef](https://github.com/Deep084-bot/atlas-rag-platform/commit/e4779ef))

### Fixed
- Enable cross-site auth cookies for production deployment ([f6f0b1e](https://github.com/Deep084-bot/atlas-rag-platform/commit/f6f0b1e))
- Embedding endpoint routing ([ebd587b](https://github.com/Deep084-bot/atlas-rag-platform/commit/ebd587b))

### Changed
- Production-ready Atlas RAG platform — full pipeline integration ([bc19ba9](https://github.com/Deep084-bot/atlas-rag-platform/commit/bc19ba9))

### Removed
- Unused Tesseract language artifact from repository ([8d1195a](https://github.com/Deep084-bot/atlas-rag-platform/commit/8d1195a))

## [v0.8.0] — 2026-06-18

### Fixed
- Stabilize OCR ingestion pipeline and conversation document lifecycle ([f088eff](https://github.com/Deep084-bot/atlas-rag-platform/commit/f088eff))

## [v1.3.0-ocr] — 2026-06-17

### Added
- OCR fallback pipeline with operational safeguards — sequential queue, pdfjs-dist + @napi-rs/canvas rendering, tesseract.js OCR, quality scoring, startup reconciliation, and document lifecycle management ([2afda1d](https://github.com/Deep084-bot/atlas-rag-platform/commit/2afda1d))

## [v1.2.0] — 2026-06-17

### Added
- Streaming chat responses with Server-Sent Events, abort controller, heartbeat keep-alive, and conversational context ([6273daa](https://github.com/Deep084-bot/atlas-rag-platform/commit/6273daa))

## [v1.1.1] — 2026-06-10

### Added
- Global React error boundary with recovery UI (refresh, retry, return to workspace) ([4c14bc8](https://github.com/Deep084-bot/atlas-rag-platform/commit/4c14bc8))

## [v1.1.0] — 2026-06-10

### Added
- Rate limiting on credential auth endpoints (10 POST/15min) and general API (200 req/15min)
- Dedicated 401 responses for unauthenticated requests
- Error classification middleware ([31a4ecd](https://github.com/Deep084-bot/atlas-rag-platform/commit/31a4ecd))

### Changed
- Ownership enforcement via `ForUser` repository method variants on document and conversation operations
- Auth middleware no longer blocks unauthenticated requests — route handlers control authorization

## [v1.0.0] — 2026-06-08

### Added
- Chat workspace with conversation panel, document library sidebar, and responsive layout ([69e5385](https://github.com/Deep084-bot/atlas-rag-platform/commit/69e5385), [93b85a1](https://github.com/Deep084-bot/atlas-rag-platform/commit/93b85a1))
- Document rename and delete with optimistic UI updates ([c911a50](https://github.com/Deep084-bot/atlas-rag-platform/commit/c911a50))
- Conversation history browsing, rename, and delete management ([def50e6](https://github.com/Deep084-bot/atlas-rag-platform/commit/def50e6), [c911a50](https://github.com/Deep084-bot/atlas-rag-platform/commit/c911a50))
- Semantic search workspace mode with pgvector ([e826dff](https://github.com/Deep084-bot/atlas-rag-platform/commit/e826dff))
- Document-to-conversation attachment with `conversation_documents` junction table

### Changed
- Redesigned authentication flow with dedicated `/login` and `/signup` routes replacing inline auth ([8941c8c](https://github.com/Deep084-bot/atlas-rag-platform/commit/8941c8c))
- Improved retrieval routing with RAG context matching, citation formatting, and source display
- File upload auto-attaches to active conversation

### Fixed
- Support pooled embedding responses from HuggingFace Inference API ([5b8fff5](https://github.com/Deep084-bot/atlas-rag-platform/commit/5b8fff5), [e8d1a4b](https://github.com/Deep084-bot/atlas-rag-platform/commit/e8d1a4b))

## [v0.9.0] — 2026-06-04

### Added
- Tenant-scoped access controls with `user_id` filtering on all document and conversation queries ([da13c65](https://github.com/Deep084-bot/atlas-rag-platform/commit/da13c65))
- Vercel build configuration (`vercel.json`) ([8982849](https://github.com/Deep084-bot/atlas-rag-platform/commit/8982849))
- serverless-http wrapper for Vercel serverless API deployment ([8982849](https://github.com/Deep084-bot/atlas-rag-platform/commit/8982849))

### Changed
- Health check endpoints routed through shared API client ([6f8083c](https://github.com/Deep084-bot/atlas-rag-platform/commit/6f8083c))
- Vercel output directory corrected from default to `web/dist` ([e8c800d](https://github.com/Deep084-bot/atlas-rag-platform/commit/e8c800d))

## [v0.8.0] — 2026-06-02

### Added
- Better Auth integration with email/password authentication, session management, and `better_auth` database schema ([0ea272f](https://github.com/Deep084-bot/atlas-rag-platform/commit/0ea272f))
- Auth middleware that lazily populates `req.user` without blocking unauthenticated requests ([021ddeb](https://github.com/Deep084-bot/atlas-rag-platform/commit/021ddeb))

## [v0.7.0] — 2026-05-31

### Added
- Automated document ingestion pipeline: upload -> extract -> chunk -> embed -> ready with status tracking and polling ([889add0](https://github.com/Deep084-bot/atlas-rag-platform/commit/889add0))
- Document upload with Multer (25MB limit, PDF/TXT validation, local filesystem persistence)
- Text extraction via pdf-parse for PDFs and UTF-8 for TXT files
- Chunking service (fixed 500-char windows with 100-char overlap)
- Embedding service with HuggingFace Inference API (model: BAAI/bge-small-en-v1.5)
- Embedding repository with pgvector (vector(384), HNSW index, cosine distance)
- Fire-and-forget processing with status guard to prevent re-ingestion
- Polling-based frontend progress tracking with exponential backoff
- Status model: uploaded -> extracting -> chunking -> embedding -> ready/failed

## [v0.6.0] — 2026-05-30

### Added
- Milestone 5 — retrieval layer with pgvector similarity search, conversation-scoped filtering, and hybrid retrieval metrics ([a865d08](https://github.com/Deep084-bot/atlas-rag-platform/commit/a865d08))
- Milestone 3 — pgvector integration with HNSW index on embedding column, query embedding via HuggingFace Inference API ([5b51cad](https://github.com/Deep084-bot/atlas-rag-platform/commit/5b51cad))
- Milestone 2 — chunk persistence with `chunks` table, unique constraint on `(document_id, chunk_index)` ([a8a236b](https://github.com/Deep084-bot/atlas-rag-platform/commit/a8a236b))
- Milestone 1 — document upload with Multer, file persistence to `uploads/` directory, document metadata in `documents` table ([9f45dac](https://github.com/Deep084-bot/atlas-rag-platform/commit/9f45dac))

### Changed
- Database schema with `documents` and `chunks` tables, pgvector extension ([cf560e4](https://github.com/Deep084-bot/atlas-rag-platform/commit/cf560e4))

## [v0.1.0] — 2026-05-30

### Added
- Initial Node.js/Express API scaffold with ESM module system ([6fd46eb](https://github.com/Deep084-bot/atlas-rag-platform/commit/6fd46eb))
- JavaScript scaffold with React + Vite frontend, Express backend, and concurrently dev runner ([7dde141](https://github.com/Deep084-bot/atlas-rag-platform/commit/7dde141))
- TailwindCSS with Atlas design tokens
- `.gitignore` for node_modules, dist, .env, uploads

[Unreleased]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.3.1...HEAD
[v1.3.1]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.3.0...v1.3.1
[v1.3.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.8.0...v1.3.0
[v0.8.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.3.0-ocr...v0.8.0
[v1.3.0-ocr]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.2.0...v1.3.0-ocr
[v1.2.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.1.1...v1.2.0
[v1.1.1]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.9.0...v1.0.0
[v0.9.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.8.0...v0.9.0
[v0.8.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.7.0...v0.8.0
[v0.7.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.6.0...v0.7.0
[v0.6.0]: https://github.com/Deep084-bot/atlas-rag-platform/compare/v0.1.0...v0.6.0
[v0.1.0]: https://github.com/Deep084-bot/atlas-rag-platform/releases/tag/v0.1.0
