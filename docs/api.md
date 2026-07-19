# API Reference

All API routes are under `/api/*`. Authentication is handled by Better Auth (session cookies).

Base URL (local dev): `http://localhost:8787`  
Base URL (Docker): `http://localhost/api`

---

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/health/db` | Database connectivity check |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/api/auth/*` | Delegated to Better Auth |

### Documents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | List user documents |
| POST | `/api/documents/upload` | Upload a document |
| GET | `/api/documents/:id` | Get document details |
| PATCH | `/api/documents/:id` | Update document metadata |
| DELETE | `/api/documents/:id` | Delete a document |
| GET | `/api/documents/:id/status` | Processing status |
| POST | `/api/documents/:id/chunk` | Manually trigger chunking |
| GET | `/api/documents/:id/chunks` | List chunks |
| POST | `/api/documents/:id/embed` | Manually trigger embedding |
| GET | `/api/documents/:id/embeddings/status` | Embedding status |

#### POST /api/documents/upload

Upload a PDF or TXT file (max 25 MB).

```
Content-Type: multipart/form-data
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | binary | yes | The file (`.pdf` or `.txt`) |
| `conversationId` | string (UUID) | no | Immediately attach to this conversation |

**Response `201`:**

```json
{
  "document": {
    "id": "uuid",
    "fileName": "example.pdf",
    "fileType": "pdf",
    "fileSizeBytes": 123456,
    "sourceType": "upload",
    "status": "uploaded",
    "progress": 10,
    "ocrQuality": null,
    "processingStartedAt": null,
    "readyAt": null,
    "failedAt": null,
    "failureReason": null,
    "createdAt": "2026-07-20T12:00:00.000Z",
    "updatedAt": "2026-07-20T12:00:00.000Z"
  }
}
```

Ingestion proceeds asynchronously: `uploaded` → processing → `ready` or `failed`.

### Search

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search` | Semantic search across all user documents |

#### POST /api/search

```json
{
  "query": "What is the fiscal policy for 2026?",
  "limit": 10
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `query` | string | yes | — | Natural-language search query |
| `limit` | number | no | 10 | Max results (capped at 25) |

**Response `200`:**

```json
{
  "matches": [
    {
      "chunkId": "uuid",
      "documentId": "uuid",
      "fileName": "report.pdf",
      "chunkIndex": 3,
      "similarity": 0.8765,
      "chunkText": "The fiscal policy outlined for 2026 includes..."
    }
  ]
}
```

### Retrieval

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/retrieval` | Conversation-scoped retrieval |

### Generation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/generate` | Generate answer with RAG context |

#### POST /api/generate

```json
{
  "question": "What is the fiscal policy for 2026?"
}
```

Internally performs search (top K=6, similarity threshold 0.5). Falls back to model-only if no relevant context found.

**Response `200`:**

```json
{
  "answer": "The fiscal policy for 2026 includes a 2% reduction...",
  "sources": [
    {
      "chunkId": "uuid",
      "documentId": "uuid",
      "fileName": "budget_2026.pdf",
      "chunkIndex": 3,
      "similarity": 0.9012,
      "chunkText": "Corporate tax will be reduced by 2% effective January 2026..."
    }
  ]
}
```

### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send a message (non-streaming) |
| POST | `/api/chat/stream` | Send a message (streaming SSE) |
| GET | `/api/chat/conversations` | List conversations |
| POST | `/api/chat/conversations` | Create a new conversation |
| PATCH | `/api/chat/conversations/:id` | Update conversation title |
| DELETE | `/api/chat/conversations/:id` | Delete a conversation |
| GET | `/api/chat/conversations/:id/messages` | Get conversation messages |
| GET | `/api/chat/conversations/:id/documents` | List attached documents |
| POST | `/api/chat/conversations/:id/documents` | Attach a document |
| DELETE | `/api/chat/conversations/:id/documents/:documentId` | Detach a document |

#### POST /api/chat

```json
{
  "conversationId": "uuid (optional, auto-creates if omitted)",
  "message": "What does the document say about revenue growth?"
}
```

**Response `200`:**

```json
{
  "conversationId": "uuid",
  "answer": "Based on the document, revenue grew by 12% year-over-year...",
  "sources": [
    {
      "chunkId": "uuid",
      "documentId": "uuid",
      "fileName": "annual_report.pdf",
      "chunkIndex": 5,
      "similarity": 0.9234,
      "chunkText": "Revenue grew 12% year-over-year driven by..."
    }
  ]
}
```

#### POST /api/chat/stream

Same request body as `POST /api/chat`. Response is a Server-Sent Events stream.

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

Events (each `data: {json}\n\n`):

| Type | Fields | Description |
|------|--------|-------------|
| `meta` | `requestId`, `conversationId` | Sent first |
| `sources` | `sources` (array) | Retrieved context chunks |
| `token` | `text` (string) | Streaming answer token |
| `ping` | — | Heartbeat every 15s |
| `done` | — | Stream complete |
| `error` | `message` | Stream error |

### Conversations

Endpoints under `/api/chat/conversations` (see section above).

---

## Common Error Responses

| Status | `error` field | Meaning |
|--------|---------------|---------|
| 400 | `*_validation_failed` | Missing or invalid request body fields |
| 400 | `file_required` | No file in upload request |
| 401 | `unauthorized` | Authentication required |
| 404 | `conversation_not_found` | Conversation does not exist or belongs to another user |
| 404 | `document_not_found` | Document does not exist or belongs to another user |
| 429 | `too_many_requests` | Rate limit exceeded (configurable) |
| 500 | `*_failed` | Internal server error |
