# 🚀 Atlas

> **A production-grade, multi-tenant Retrieval-Augmented Generation (RAG) platform for intelligent document conversations.**

Atlas enables users to upload PDF and TXT documents, perform semantic search using vector embeddings, and interact with their knowledge base through citation-aware AI conversations.

---

## ✨ Features

- 📄 PDF & TXT document ingestion
- 🖼️ OCR support for scanned PDF documents
- 🔍 Semantic search powered by vector embeddings
- 💬 Citation-aware AI conversations
- 👥 Secure multi-user authentication
- ⚡ Streaming AI responses
- 🧠 PostgreSQL + pgvector vector storage
- 📦 Modular backend architecture
- 🌐 Responsive React frontend

---

# 🏗️ System Architecture

```text
                 User
                  │
                  ▼
          React Frontend
                  │
                  ▼
          Express.js Backend
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
 Better Auth          PostgreSQL
 Authentication        + pgvector
                            │
                            ▼
                    Vector Embeddings
                            │
                            ▼
                   Semantic Retrieval
                            │
                            ▼
                         Groq LLM
                            │
                            ▼
                 Citation-Aware Response
```

---

# 🔄 Retrieval Pipeline

## 🔄 Retrieval Pipeline

```text
PDF Upload
      │
      ▼
Document Classification
      │
      ├──────────────┐
      │              │
      ▼              ▼
Text PDF       Scanned PDF
      │              │
      ▼              ▼
Text Extraction     OCR
      └──────┬───────┘
             ▼
    Recursive Chunking
             ▼
   Embedding Generation
             ▼
      Store in pgvector
             ▼
      Semantic Search
             ▼
     Context Injection
             ▼
          Groq LLM
             ▼
  Citation-Aware Response
```
---
## 📄 OCR Pipeline

Atlas automatically detects scanned PDF pages and extracts text using an OCR pipeline before indexing the content into the vector database.

This enables semantic search and citation-aware conversations over documents that do not contain embedded text.

# 🛠️ Tech Stack

## Frontend

- React
- Vite
- TailwindCSS

## Backend

- Node.js
- Express.js

## Database

- PostgreSQL (Neon)
- pgvector

## Authentication

- Better Auth

## AI

- Groq
- Local Embedding Models

---

# 📁 Project Structure

```text
Atlas
│
├── api/                 # Vercel Serverless Functions
├── database/            # PostgreSQL schema
├── server/              # Express Backend
├── web/                 # React Frontend
├── package.json
└── README.md
```

---

# ⚙️ Getting Started

## Clone the Repository

```bash
git clone https://github.com/Deep084-bot/atlas.git
cd atlas
```

---

## Install Dependencies

```bash
npm install
```

---

## Configure Environment Variables

Create a `.env` file with the following variables.

```env
GROQ_API_KEY=

GROQ_MODEL=

DATABASE_URL=

BETTER_AUTH_URL=

BETTER_AUTH_SECRET=

WEB_ORIGIN=

HF_API_KEY=

EMBEDDING_PROVIDER=

VITE_API_BASE_URL=
```

---

## Run Development Server

```bash
npm run dev
```

Available scripts

```bash
npm run dev
npm run dev:web
npm run dev:api
npm run build
```

---

# 💡 Design Decisions

Atlas was designed with a production-oriented architecture instead of a prototype-first approach.

Some key design choices include:

- PostgreSQL + pgvector for integrated relational and vector storage
- Better Auth for secure session management
- Modular Express backend for maintainability
- Local embedding models to reduce inference costs
- Streaming responses for improved user experience
- Repository-oriented project organization
- OCR integration enables processing of scanned PDF documents alongside digitally generated PDFs.

---

# 🚀 Roadmap

- [x] Authentication
- [x] PDF ingestion
- [x] Semantic retrieval
- [x] Citation-aware chat
- [x] Streaming responses
- [x] OCR Support

### Planned

- [ ] Hybrid Search (BM25 + Vector Search)
- [ ] Cross-Encoder Re-ranking
- [ ] Conversation Memory
- [ ] Collection Sharing
- [ ] Retrieval Evaluation Dashboard
- [ ] Docker Deployment

---

## 📚 What I Learned

Building Atlas helped me gain practical experience with:

- Retrieval-Augmented Generation (RAG)
- OCR pipelines for scanned documents
- Vector databases using pgvector
- Semantic search pipelines
- Authentication systems
- Production backend architecture
- AI application deployment
- Streaming APIs
- Full-stack application development

---

# 🤝 Contributing

Contributions, discussions, and suggestions are always welcome.

If you find a bug or have an idea for improvement, feel free to open an issue or submit a pull request.

---

# 📄 License

This project is licensed under the MIT License.
