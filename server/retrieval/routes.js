import { Router } from 'express';

import { classifyError } from '../errors.js';

export function createRetrievalRouter({ retrievalService }) {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const userId = request.user?.id;

      if (!userId) {
        return response.status(401).json({
          error: 'unauthorized',
          category: 'authentication',
          message: 'Authentication required.'
        });
      }

      const result = await retrievalService.retrieve(request.body?.query, {
        topK: request.body?.topK,
        similarityThreshold: request.body?.similarityThreshold,
        userId
      });

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'retrieval_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'retrieval_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}