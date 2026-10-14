Atlas Production Failure — Root Cause Investigation (Read-Only)

Date: 2026-10-14

1. Confirmed findings (evidence-backed)
- Commit 440d42c (HEAD) migrated Groq to openai/gpt-oss-20b. config.js defaults GROQ_MODEL to openai/gpt-oss-20b; GroqProvider uses max_completion_tokens and include_reasoning:false for both generate() and generateStream(). (config.js:25; GroqProvider.js:39-47,108-115)
- app.js selects EMBEDDING_PROVIDER from env (default 'huggingface'). If huggingface, constructs HuggingFaceProvider with model 'BAAI/bge-small-en-v1.5' and HF_API_KEY. (app.js:61-69)
- HuggingFaceProvider calls HF Inference endpoint: POST to .../models/{model}/pipeline/feature-extraction with inputs (string or array), options.wait_for_model:true. Uses fetchWithRetry (timeout 15000, retries 2). On non-2xx/retry exhaustion throws ProviderError including response body. (HuggingFaceProvider.js:87-138; fetchWithRetry.js:39-55)
- normalizeEmbeddingOutput returns [] when payload is empty (44-46). For single text, code returns [normalized] only if normalized is array of numbers of length>0; otherwise it logs and returns normalized (which can be []). (HuggingFaceProvider.js:43-72,128-138)
- searchService.search() embeds query and throws "Embedding provider returned an empty query embedding." if result is empty array. (searchService.js:30-35)
- documentOrchestrator.processDocument() catches any embedding error and calls documentsRepository.markFailed() with failureReason; upload is fire-and-forget (void startDocumentIngestion) so failures are logged and document marked failed unless process crashes mid-await. (documentOrchestrator.js:66-70,189-206; routes.js:190)
- reconcileStuckDocuments() runs at startup and marks documents in extracting/ocr/chunking/embedding older than 30 min (or processing_started_at NULL) as failed with interruption message. (reconcileStuckDocuments.js:1-25; index.js:18-24)
- chat stream: errors before headers sent return JSON via classifyError (ProviderError preserves statusCode -> often 502). Errors after headers sent write SSE error and end. Persistence of assistant message happens after response.end() (lines 156-177 in routes). (chat/routes.js:66-211)
- Schema: chunks.embedding is vector(384); HNSW index on cosine. (schema.sql:40,47)
- Frontend: multiple createRadialGradient calls with computed radii (can be < 0 in edge cases). (KnowledgeOrb.jsx:79,118,156,165; KnowledgeCore.jsx:131,154,180; KnowledgeFlow.jsx:158; KnowledgeGraph.jsx:311)

2. Root-cause chain
- Primary (confirmed): HF Inference credits exhausted -> HF returns error (e.g. "no remaining credits...") or possibly malformed response. Provider throws ProviderError. 
- Query embedding: searchService throws "empty query embedding" if provider returns [] (due to normalization returning empty). That Error is classified as internal -> HTTP 500 for chat/stream paths when thrown before headers sent. (errors.js:62-67; searchService.js:32-35)
- Document embedding: embeddingService throws if batch result length mismatches (e.g. provider returns []). Orchestrator catches and marks document failed (so it should not remain indefinitely in Processing unless the process crashes between status transition and the catch). Startup reconciliation exists for crash case.
- Groq: repo defaults to openai/gpt-oss-20b and correct params; any legacy model error is likely from deployment env override (not source). 
- Canvas: rendering math produces negative radius -> IndexSizeError (independent of backend).

3. File-by-file key refs (exact paths/lines)
See detailed refs above.

4. Recommended zero-cost embedding approach
- Implement in-process LocalTransformersEmbeddingProvider using @xenova/transformers with BAAI/bge-small-en-v1.5 (ONNX quantized). Keep model/dim 384. 
- Make provider selectable via EMBEDDING_PROVIDER (keep huggingface as fallback). 
- Rationale: zero cost, no quota, preserves schema/dim, uses existing EmbeddingProvider interface (LocalTransformersProvider stub exists). 
- Feasibility (CPU Render): quantized bge-small-en-v1.5 needs ~200-300MB RAM; acceptable on 512MB+ with batch size 8. First-run model download requires cache or build-time fetch.

5. Minimal fix plan (priority order)
P0:
- HuggingFaceProvider: throw ProviderError if normalized result is empty for any requested text (include provider name/status 502). 
- embeddingService: validate each embedding is a non-empty number array and length === 384 before storing. 
- searchService: when embedding is empty, throw ProviderError (provider 'embedding', status 502) instead of generic Error.
- Implement LocalTransformersEmbeddingProvider (in-process) and wire in app.js; keep HF configurable.

P1:
- Frontend: clamp radii to >=1 before createRadialGradient; guard zero canvas rects. 
- Health check: add /api/health/embeddings (light embed + dimension check) returning 200/503.

P2:
- Periodic reconciliation (interval) in addition to startup; reduce debug console logs in production.

6. Risks & compatibility
- Model parity: same model+normalization preserves cosine behavior; existing vector(384) rows remain valid.
- Memory/download: mitigate with quantized model and caching.
- Schema unchanged.

7. Verification
- Mock HF errors/empty payloads -> correct status classification. 
- Upload failure -> document marked failed with provider message. 
- Stuck docs reconciled on startup. 
- Local embed returns 384-dim unit-norm vectors. 
- Canvas no IndexSizeError. 
- Streaming: provider errors before headers -> JSON error; after headers -> SSE error.

8. Safest next step
Implement P0 fixes: harden provider empty-result handling (provider + searchService + embeddingService), then add local embedding provider behind EMBEDDING_PROVIDER=local (preserving HF fallback). Do not change schema or stored embeddings. Frontend radius clamp can follow as separate small fix.
