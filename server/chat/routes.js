import { Router } from 'express';

import { classifyError } from '../errors.js';

export function createChatRouter({ chatService }) {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const result = await chatService.chat({
        conversationId: request.body?.conversationId,
        message: request.body?.message
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