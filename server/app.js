import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { getPool } from "./db.js";
import { DocumentsRepository } from './documents/repository.js';
import { createDocumentsRouter } from './documents/routes.js';
import { LocalStorageProvider } from './storage/local.js';
import { verifyDatabaseConnection } from './db.js';

dotenv.config();

const app = express();
const storageProvider = new LocalStorageProvider();
const documentsRepository = new DocumentsRepository(getPool());

app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? true,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api/documents', createDocumentsRouter({ storageProvider, documentsRepository }));

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
