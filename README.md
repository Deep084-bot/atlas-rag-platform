# Atlas

Atlas is a personal knowledge platform for PDF and TXT ingestion, semantic search, and citation-aware chat.

## Stack

- Frontend: React, Vite, TailwindCSS
- Backend: Node.js, Express.js
- Database: Neon PostgreSQL, pgvector
- Generation: Groq
- Embeddings: local models

## Current slice

This repository now contains the initial implementation scaffold:

- A Vite React frontend shell in `web/`
- An Express API in `server/`
- A Vercel-compatible serverless entrypoint in `api/`
- The first PostgreSQL schema in `database/schema.sql`

## Scripts

- `npm run dev` starts the web app and API together
- `npm run dev:web` starts the frontend only
- `npm run dev:api` starts the API only
- `npm run build` builds both layers

The codebase is now JavaScript-first, so there is no TypeScript check step in this scaffold.

## Environment

Create a local `.env` file with at least:

- `GROQ_API_KEY`
- `GROQ_MODEL`
- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_SECRET`
- `WEB_ORIGIN`
- `HF_API_KEY`
- `EMBEDDING_PROVIDER`
- `VITE_API_BASE_URL`
