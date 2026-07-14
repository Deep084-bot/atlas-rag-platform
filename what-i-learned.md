# What I Learned

## What I Knew Before Starting

I had built Node.js APIs with Express before and had basic familiarity with React hooks and PostgreSQL. I had never worked with vector databases, OCR pipelines, LLM providers, or streaming server-sent events on the server side. My mental model of "AI application" was basically "call an API with a prompt, get text back."

## New Concepts Learned

**pgvector and HNSW indexes.** I knew vector search existed conceptually but had never used it. The HNSW index with cosine distance was a practical education in approximate nearest neighbor search — what the `<=>` operator does, why 384 dimensions, how the index build time and recall trade off against each other.

**RAG routing beyond similarity search.** The naive approach is "retrieve top-K chunks, stuff them into a prompt." But the overlap gate in this project — counting how many query terms of length >= 4 actually appear in the retrieved chunk text — was something I had not considered. Embedding similarity alone can produce false positives. A query like "tell me about the weather" can be semantically close to a chunk about "climate data" without any actual term overlap in a way that makes the answer useless for the user. The overlap gate catches this.

**pdfjs-dist in Node.js is not the same as pdfjs-dist in the browser.** In the browser, page objects are garbage-collected when the user navigates. In Node.js, each `PDFDocumentProxy` holds ~50-100MB of parsed structure until you explicitly call `doc.destroy()`. The engineering review flagged this as a high-severity memory leak. I would not have caught this without a review process.

**Tesseract.js worker lifecycle.** The worker is a WebAssembly instance holding the English language model (~50-80MB). You cannot just create one per page — you create one, reuse it across pages, then terminate. If you forget to terminate, the worker stays in memory. The per-page error isolation — wrapping each `worker.recognize()` call individually so one bad page does not fail the entire document — was a pattern I had not used before.

**SSE streaming on the server side involves a surprising amount of plumbing.** The heartbeat interval, the buffer management for split SSE frames, the AbortController propagation from the HTTP request through the Groq API call, and the message persistence after the response ends. The most counterintuitive part: the DB write for the assistant message happens after `response.end()`, so a failure there means the user saw the answer but it disappears on page reload.

## Mistakes Made

**Committed the .env file with live API keys.** The `.env` file is in the repository with valid Groq API key, HuggingFace API key, database URL, and auth secret. This should have been in `.gitignore` from the first commit. The `.gitignore` was added later (commit `cf560e4`) but already allowed `.env` through — the fix would be to add `.env` to gitignore and strip it from history.

**Designed the OCR pipeline with sharp before realizing @napi-rs/canvas does the same job with less memory.** The initial architecture document specified `pdfjs-dist + sharp`. The engineering review revealed that `@napi-rs/canvas` can produce PNG buffers directly via `canvas.toBuffer()`, eliminating sharp's ~30-50MB memory overhead and one native dependency. This was a preventable mistake — I should have surveyed the canvas library options before writing the architecture doc.

**Fire-and-forget with no recovery path.** The document ingestion pipeline calls `void processDocument()` and returns the HTTP response immediately. When the process crashes mid-ingestion, the document stays in `ocr` or `extracting` status forever. The startup reconciliation was added as a fix after the operational resilience review flagged this as high severity. This should have been designed in from the start.

**Duplicated `computeOverlap` across two files.** The same function exists in `chatService.js` and `generationService.js`. This is the kind of copy-paste that happens when two features are built in parallel and neither developer (or in this case, neither session) extracts the shared utility. It works but it means any change to the overlap logic must be made in two places.

**BETTER_AUTH_URL defaults to localhost.** The fallback value is `http://localhost:8787`. If someone deploys to production without setting this environment variable, auth sessions break silently — cookies are set against the wrong origin. The server validates `DATABASE_URL` and `GROQ_API_KEY` at startup but does not validate `BETTER_AUTH_URL`.

## Interesting Bugs

**The queue lock that never releases.** The OCR queue uses an in-process mutex. If the OCR job throws between `acquire()` and `release()`, the lock stays acquired forever. Every subsequent OCR job waits in the queue until the 300-second timeout. The fix was wrapping the entire OCR body in try/finally. This is a basic concurrency pattern that I should not have needed a review to catch.

**pdfjs-dist page/document leak.** pdfjs-dist's `getDocument()` returns a `PDFDocumentProxy` that holds the entire parsed PDF structure. `getPage()` returns a `PDFPageProxy` with rendered bitmap data. In the browser, these get garbage-collected. In Node.js, they do not. Without `page.cleanup()` and `doc.destroy()` in `finally` blocks, memory grows linearly with each OCR'd document. The first version of the OCR code did not have these calls.

**Message persistence after response.end().** The streaming chat endpoint sends the SSE response, calls `response.end()`, and then persists the assistant message to the database. If the DB write fails, the user already received the full answer but it disappears on page reload. The root cause is that streaming is prioritized over persistence — the trade-off was accepted consciously, but it creates a subtle data loss scenario that users will not understand.

**The commented-out fetchConversationDocuments call.** In `useChat.js`, there is a TODO comment: "remove after confirming no race" next to a commented-out `fetchConversationDocuments()` call. This suggests a race condition was encountered during development between the conversation creation and the initial document fetch, and the dev was not confident enough to remove the workaround.

## Tools Discovered

**Groq.** Fast LLM inference with an OpenAI-compatible API. The key advantage over OpenAI for this project was speed — token-by-token latency is noticeably lower. The API format meant the `GroqProvider` could reuse standard `chat/completions` request structures.

**@napi-rs/canvas.** Prebuilt N-API bindings for the Canvas API. Unlike `node-canvas`, which requires system dependencies (cairo, pango, libjpeg), this ships prebuilt binaries for linux-x64-gnu, darwin-arm64, etc. It was the difference between "works on Railway with zero config" and "needs a buildpack."

**serverless-http.** Wraps an Express app into a Vercel-compatible serverless function handler. The abstraction is thin — just `export default serverless(app)` — but it means the same Express app runs on Railway (long-running process) and Vercel (per-request invocation) with no code changes.

**concurrently.** The dev script runner that starts the Vite dev server and Express API in parallel. Simple, zero-config, and it handles the colored output prefixing (`-n web,api -c cyan,green`). I had been opening two terminal tabs before this project.

**Better Auth.** An auth library that handles email/password, session management, and OAuth through a single `betterAuth()` config call. The Drizzle ORM adapter meant it integrated with the existing PostgreSQL connection without a separate auth database.

**react-hot-toast.** Lightweight toast notifications for React. Used throughout the frontend for login success, error messages, and status updates. Worth mentioning because it replaced the usual 200-line toast implementation I would have written myself.

## Engineering Insights

**In-process concurrency is simpler than external queues, but loses state on crash.** The OCR queue uses a JavaScript-level mutex (`lockAcquired` boolean + callback array). No Redis, no Bull, no external infrastructure. This works perfectly for a single-process deployment and survives the vast majority of usage. But a process crash loses queued jobs permanently. The startup reconciliation recovers stuck documents, not queued-but-unstarted jobs. For a hobby-tier deployment, this trade-off is correct. For production with business requirements, it would not be.

**Permissionless auth middleware makes incremental feature development smoother.** The middleware populates `req.user` when a session is present but does not reject unauthenticated requests. Each route handler decides whether auth is required. This pattern meant I could add routes without thinking about auth first, then add the auth check later without changing the route's structure. The alternative — middleware that rejects unauthenticated requests by default — would have required whitelisting every public endpoint.

**Abstract provider interfaces are worth the boilerplate in the first iteration.** The `EmbeddingProvider`, `GenerationProvider`, and `StorageProvider` abstract classes define interfaces before any second implementation exists. The first implementation gets the boilerplate of defining a class that extends the abstract. The second implementation gets nothing but the method signatures. The `LocalTransformersProvider` stub exists because the interface was defined before anyone wrote the implementation. This pattern is cheap early and expensive to retrofit later.

**Fixed-window chunking with overlap is surprisingly effective for retrieval.** 500-character windows with 100-character overlap is naive — it splits mid-sentence and mid-word. But for vector search, uniform chunk size means uniform embedding quality. The overlap ensures that boundary terms appear in at least one chunk. The SYSTEM_AUDIT.md notes this produces "awkward chunk boundaries" but the retrieval metrics (not measured formally, but observed qualitatively) are good enough that improving chunking has not been the bottleneck.

**The threshold-based OCR trigger (50 characters) is a well-calibrated heuristic.** The 50-character threshold was chosen because scanned PDFs typically yield 0-20 characters (whitespace, metadata artifacts) while text PDFs yield hundreds to thousands. This is documented in OCR_ARCHITECTURE.md with the rationale that the threshold is "safely above noise floor but below any legitimate content." Having analyzed the extraction output during development, the threshold triggers OCR on documents that need it and skips it on documents that do not, with no false positives observed.

## What I Would Do Differently Next Time

**Start with the operational resilience review.** The OCR pipeline was designed, implemented, and reviewed. The review caught two high-severity issues (queue lock never released, pdfjs-dist memory leak) and one medium-severity issue (no startup reconciliation). Next time, I would write the "what happens when this crashes" document before writing the implementation code, not after.

**Add a migration runner from the start.** The migrations are SQL files applied manually. There is no tool that tracks which migrations have been applied or in what order. For a project with 9 migrations and counting, this is already a problem. Knex migrations or a simple `migrate` table would prevent the manual step from being forgotten during deployment.

**Not commit .env.** This is obvious in retrospect. The `.env` file contains secrets that should never be in version control. Adding it to `.gitignore` on day one would have prevented the current state where every clone gets live credentials.

**Use a proper logging library.** The codebase has 42 `console.log()` calls with prefixes like `[OCR]`, `[atlas]`, `[DOC MATCH]`, `[RAG CHUNK]`, `[SUMMARY PROMPT PREVIEW]`. These are development logs that should not be in production. A structured logger with level-based filtering would make the distinction explicit.

**Build the periodic reconciliation alongside the startup one.** The startup reconciliation handles the crash-restart cycle. But what if the server runs for weeks without restarting? Documents stuck mid-processing stay stuck until the next deploy. A 5-minute periodic check would be a 10-line setInterval call.

## Topics I Should Study Next

**Local embedding inference.** The `LocalTransformersProvider` stub throws "not implemented yet." Implementing it would mean learning how to run transformer models (Xenova/Transformers.js) in Node.js for embedding generation without an external API. This would reduce latency and remove the HuggingFace API dependency.

**Sentence-aware chunking algorithms.** The current fixed-window chunking works but produces awkward chunk boundaries. I want to understand how to detect sentence boundaries, paragraph breaks, and section headings in a way that produces semantically coherent chunks. The LangChain and LlamaIndex chunking strategies would be a starting point.

**Persistent job queues for Node.js.** Bull with Redis is the standard. I want to understand how to structure a job queue that survives process crashes, supports job retries with exponential backoff, and provides visibility into job progress — all things the current in-process OCR queue does not do.

**OpenAI-compatible provider protocols.** The `GenerationProvider` interface is designed for multiple providers. I want to understand the differences between the Groq, OpenAI, Anthropic, and Together API formats — particularly around streaming, tool calling, and structured output — to know how much abstraction each provider needs behind the same interface.

**Serverless-compatible async processing.** The fire-and-forget pattern does not work in serverless environments where the runtime terminates after the response. I want to understand patterns like Cloudflare Queues, AWS SQS-triggered functions, or Vercel's own background functions for handling async work in serverless contexts.
