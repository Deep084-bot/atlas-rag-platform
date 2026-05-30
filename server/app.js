import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

dotenv.config();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? true,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get(['/health', '/api/health'], (_request, response) => {
  response.json({
    service: 'atlas-api',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
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
