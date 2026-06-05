import { Router } from 'express';

import { classifyError } from '../errors.js';

function authenticate(request, response) {
  const userId = request.user?.id;

  if (!userId) {
    response.status(401).json({
      error: 'unauthorized',
      category: 'authentication',
      message: 'Authentication required.'
    });
    return null;
  }

  return userId;
}

export function createChatRouter({ chatService }) {
  const router = Router();

  router.post('/', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
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

  router.get('/conversations', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const conversations = await chatService.listConversations(userId);

      return response.json(conversations);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversations_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversations_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.get('/conversations/:id/messages', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const messages = await chatService.getConversationMessages(request.params.id, userId);

      if (!messages) {
        return response.status(404).json({
          error: 'conversation_not_found',
          category: 'validation',
          message: 'Conversation not found.'
        });
      }

      return response.json(messages);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_messages_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_messages_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}