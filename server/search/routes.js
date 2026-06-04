import { Router } from 'express';

import { classifyError } from '../errors.js';

export function createSearchRouter({ searchService }) {
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

      const result = await searchService.search(request.body?.query, {
        limit: request.body?.limit,
        userId
      });

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'search_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'semantic_search_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}