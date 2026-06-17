import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { getPool } from "./db.js";
import { DocumentsRepository } from './documents/repository.js';
import { createDocumentsRouter } from './documents/routes.js';
import { createDocumentOrchestrator } from './documents/documentOrchestrator.js';
import { ChunkRepository } from './ingestion/chunkRepository.js';
import { createChunkService } from './ingestion/chunkService.js';
import { EmbeddingRepository } from './embeddings/embeddingRepository.js';
import { createEmbeddingService } from './embeddings/embeddingService.js';
import { HuggingFaceProvider } from './embeddings/HuggingFaceProvider.js';
import { LocalTransformersProvider } from './embeddings/LocalTransformersProvider.js';
import { LocalStorageProvider } from './storage/local.js';
import { ConversationRepository } from './chat/conversationRepository.js';
import { ConversationDocumentRepository } from './chat/conversationDocumentRepository.js';
import { createChatRouter } from './chat/routes.js';
import { createChatService } from './chat/chatService.js';
import { createGenerationRouter } from './generation/routes.js';
import { createGenerationConfig } from './generation/config.js';
import { GroqProvider } from './generation/GroqProvider.js';
import { buildGenerationPrompt } from './generation/promptBuilder.js';
import { createGenerationService } from './generation/generationService.js';
import { SearchRepository } from './search/searchRepository.js';
import { createSearchRouter } from './search/routes.js';
import { createSearchService } from './search/searchService.js';
import { createRetrievalRouter } from './retrieval/routes.js';
import { createRetrievalService } from './retrieval/retrievalService.js';
import { verifyDatabaseConnection } from './db.js';
import { authHandler, authMiddleware } from './auth.js';
import { ocrPdf } from './ocr/ocrService.js';

dotenv.config();

const app = express();
const generationConfig = createGenerationConfig();
const storageProvider = new LocalStorageProvider();
const pool = getPool();
const documentsRepository = new DocumentsRepository(pool);
const chunkRepository = new ChunkRepository(pool);
const embeddingRepository = new EmbeddingRepository(pool);
const conversationRepository = new ConversationRepository(pool);
const conversationDocumentRepository = new ConversationDocumentRepository(pool);
const searchRepository = new SearchRepository(pool);
const chunkService = createChunkService({ documentsRepository, chunkRepository });
const documentOrchestrator = createDocumentOrchestrator({ documentsRepository, chunkService, ocrService: { ocrPdf } });
const embeddingProviderName = (process.env.EMBEDDING_PROVIDER ?? 'huggingface').toLowerCase();
const embeddingProvider =
  embeddingProviderName === 'local' || embeddingProviderName === 'local-transformers'
    ? new LocalTransformersProvider()
    : new HuggingFaceProvider({
        apiKey: process.env.HF_API_KEY,
        model: 'BAAI/bge-small-en-v1.5'
      });
const embeddingService = createEmbeddingService({
  documentsRepository,
  embeddingRepository,
  embeddingProvider
});
documentOrchestrator.setEmbeddingService(embeddingService);
const searchService = createSearchService({
  embeddingProvider,
  searchRepository
});
const retrievalService = createRetrievalService({
  searchService
});
const generationProvider = new GroqProvider({
  apiKey: generationConfig.groqApiKey,
  model: generationConfig.groqModel,
  baseUrl: generationConfig.groqBaseUrl
});
const generationService = createGenerationService({
  retrievalService,
  generationProvider,
  buildPrompt: buildGenerationPrompt,
  defaultTopK: generationConfig.retrievalTopK,
  maxTopK: 12,
  defaultSimilarityThreshold: generationConfig.retrievalSimilarityThreshold,
  temperature: generationConfig.temperature,
  maxTokens: generationConfig.maxTokens
});
const chatService = createChatService({
  conversationRepository,
  conversationDocumentRepository,
  retrievalService,
  generationService,
  historyLimit: 6,
  retrievalTopK: generationConfig.retrievalTopK,
  similarityThreshold: generationConfig.retrievalSimilarityThreshold
});

app.use(helmet());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? true,
    credentials: true
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.all('/api/auth/*', authHandler);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'rate_limit_exceeded',
    category: 'validation',
    message: 'Too many requests. Please try again later.',
  },
});

app.use('/api', apiLimiter);

app.use(express.json({ limit: '2mb' }));
app.use(authMiddleware);

app.use(
  '/api/documents',
  createDocumentsRouter({
    storageProvider,
    documentsRepository,
    chunkService,
    embeddingService,
    documentOrchestrator,
    conversationDocumentRepository
  })
);
app.use('/api/search', createSearchRouter({ searchService }));
app.use('/api/retrieval', createRetrievalRouter({ retrievalService }));
app.use('/api/generate', createGenerationRouter({ generationService }));
app.use('/api/chat', createChatRouter({ chatService, conversationRepository, conversationDocumentRepository }));

app.get(['/health', '/api/health'], (_request, response) => {
  response.json({
    service: 'atlas-api',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health/db', async (_request, response) => {
  try {
    await verifyDatabaseConnection();

    return response.json({
      ok: true,
      database: 'connected'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Database connection failed.';
    return response.status(503).json({
      ok: false,
      database: 'disconnected',
      message
    });
  }
});

app.get(['/api', '/api/status'], (_request, response) => {
  response.json({
    name: 'Atlas API',
    features: ['uploads', 'semantic-search', 'chat', 'citations'],
    status: 'bootstrapped'
  });
});

app.use((_request, response) => {
  response.status(404).json({
    error: 'not_found'
  });
});

export default app;
