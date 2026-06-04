import { Router } from 'express';

import { classifyError } from '../errors.js';

export function createChatRouter({ chatService }) {
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

      const result = await chatService.chat({
        conversationId: request.body?.conversationId,
        message: request.body?.message,
        userId
      });

      if (!result) {
        return response.status(404).json({
          error: 'conversation_not_found',
          category: 'validation',
          message: 'Conversation not found.'
        });
      }

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'chat_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'chat_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}