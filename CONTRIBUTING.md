# Contributing to Atlas

Thank you for your interest in contributing to Atlas. This document provides guidelines and instructions for contributors.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Docker Development](#docker-development)
- [Project Scripts](#project-scripts)
- [Coding Standards](#coding-standards)
- [Branch Naming](#branch-naming)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Code Review Expectations](#code-review-expectations)
- [Getting Help](#getting-help)

---

## Prerequisites

- **Node.js** 18+ (20+ recommended for Docker)
- **npm** 9+
- **PostgreSQL** 16+ with the **pgvector** extension
  - Or a [Neon](https://neon.tech) serverless PostgreSQL account
- API keys:
  - [Groq](https://console.groq.com/keys) for LLM generation
  - [HuggingFace](https://huggingface.co/settings/tokens) for embeddings (if using the default provider)

---

## Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/atlas.git
cd atlas
```

### 2. Install dependencies

```bash
npm install
```

This installs all dependencies (frontend and backend) into a single `node_modules/` at the project root.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials. At minimum, set:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/atlas
GROQ_API_KEY=gsk_your_groq_key
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
```

### 4. Initialize the database

Ensure PostgreSQL is running with the pgvector extension enabled, then apply the schema:

```bash
psql -d your_database -f database/schema.sql
```

Or apply migrations individually from `database/migrations/` in order.

### 5. Start development servers

```bash
npm run dev
```

This starts both servers concurrently:
- **Frontend** (Vite dev server): [http://localhost:5173](http://localhost:5173)
- **Backend** (Express with hot-reload): [http://localhost:8787](http://localhost:8787)

The Vite dev server proxies `/api/*` requests to the backend.

---

## Docker Development

If you prefer to run the entire stack in Docker:

```bash
# Development with hot-reload
docker compose -f docker-compose.dev.yml up --build -d

# Follow logs
docker compose -f docker-compose.dev.yml logs -f

# Stop
docker compose -f docker-compose.dev.yml down
```

Or use the Makefile:

```bash
make docker-dev-start
make docker-dev-logs
make docker-dev-stop
```

The development compose file mounts source directories as volumes, so changes to `server/` or `web/` are reflected immediately.

---

## Project Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both frontend and backend in development mode |
| `npm run dev:web` | Start only the Vite frontend dev server |
| `npm run dev:api` | Start only the Express backend with `--watch` |
| `npm run build` | Build the frontend for production |
| `npm run build:web` | Build the frontend for production (explicit) |
| `npm start` | Start the Express backend in production mode |
| `npm run lint` | Run the linter (placeholder — not yet implemented) |

---

## Coding Standards

### Language and Runtime

- **ECMAScript Modules (ESM)** — all `.js` files use `import`/`export`. The project has `"type": "module"` in `package.json`.
- **No TypeScript** — the codebase is JavaScript. JSDoc comments are used for critical interfaces (base classes, public API methods).
- **Node.js** — target runtime is Node.js 18+.

### Formatting

There is no Prettier or ESLint configuration yet. Follow the existing style:

- 2-space indentation
- Semicolons required
- Single quotes for strings
- Trailing commas in multiline objects and arrays
- `async/await` over raw promises
- `===` over `==`

### Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Variables and functions | camelCase | `getPool()`, `embedDocument` |
| Classes | PascalCase | `HuggingFaceProvider`, `SearchRepository` |
| Files | camelCase | `embeddingService.js`, `conversationRepository.js` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_CHUNK_SIZE`, `MAX_QUEUE_DEPTH` |
| Environment variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `GROQ_API_KEY` |

### Error Handling

- Use the error hierarchy in `server/errors.js`:
  - `ValidationError` — invalid user input (maps to HTTP 400)
  - `ProviderError` — external service failure (maps to HTTP 502)
  - `DatabaseError` — database failure (maps to HTTP 503)
- Route handlers should wrap async logic in try/catch and call `classifyError()` for consistent error responses.
- Do not expose internal error details to API clients.

### Module Structure

Backend modules follow this pattern:

```
module/
├── routes.js            # Express router (thin — validates, delegates)
├── service.js           # Business logic (orchestrates, decides)
├── repository.js        # Data access (SQL queries)
└── config.js            # Module-specific configuration
```

Base classes are named with a suffix: `EmbeddingProvider`, `GenerationProvider`, `StorageProvider`.

---

## Branch Naming

Use descriptive branch names with a prefix:

- `feat/` — new features
- `fix/` — bug fixes
- `docs/` — documentation changes
- `refactor/` — code refactoring without behavior changes
- `chore/` — build process, dependencies, tooling
- `docker/` — Docker infrastructure changes

Examples: `feat/hybrid-search`, `fix/ocr-timeout`, `docs/api-reference`

---

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`

Examples:
```
feat(docker): add multi-stage production Dockerfile
fix(db): handle missing DATABASE_SSL env var
docs(readme): add Docker quick start section
refactor(chat): extract shared logic from chat and chatStream
```

---

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes following the coding standards above.
3. Run `npm run build` to verify the frontend builds successfully.
4. If you added or modified Docker infrastructure, verify `docker compose build` succeeds.
5. Open a pull request using the [PR template](.github/PULL_REQUEST_TEMPLATE.md).
6. Ensure the PR description clearly describes the motivation and changes.
7. A maintainer will review within 3–5 business days.

### Before Submitting

- [ ] Frontend builds without errors (`npm run build`)
- [ ] Docker builds without errors (`docker compose build`)
- [ ] No new environment variables added without documentation
- [ ] Changes are backwards-compatible (no breaking API changes)
- [ ] No secrets, credentials, or tokens in code or commit messages

---

## Code Review Expectations

- All PRs require at least one approving review from a maintainer.
- Reviewers will check for correctness, maintainability, and adherence to existing patterns.
- Address review feedback with additional commits — do not squash until approved.
- Once approved, a maintainer will merge the PR.

---

## Getting Help

- Open a [GitHub Discussion](https://github.com/yourusername/atlas/discussions) for questions
- Open an [Issue](https://github.com/yourusername/atlas/issues) for bugs or feature requests
- Security vulnerabilities: see [SECURITY.md](SECURITY.md)
