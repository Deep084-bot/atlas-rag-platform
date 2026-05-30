import { Router } from 'express';

export function createRetrievalRouter({ retrievalService }) {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const result = await retrievalService.retrieve(request.body?.query, {
        topK: request.body?.topK,
        similarityThreshold: request.body?.similarityThreshold
      });

      return response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retrieve context.';

      if (message === 'query is required.') {
        return response.status(400).json({
          error: 'retrieval_validation_failed',
          message
        });
      }

      return response.status(500).json({
        error: 'retrieval_failed',
        message
      });
    }
  });

  return router;
}