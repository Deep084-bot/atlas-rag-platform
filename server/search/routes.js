import { Router } from 'express';

export function createSearchRouter({ searchService }) {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const result = await searchService.search(request.body?.query, {
        limit: request.body?.limit
      });

      return response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to search chunks.';

      if (message === 'query is required.') {
        return response.status(400).json({
          error: 'search_validation_failed',
          message
        });
      }

      return response.status(500).json({
        error: 'semantic_search_failed',
        message
      });
    }
  });

  return router;
}