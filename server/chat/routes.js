import { Router } from 'express';
import { randomUUID } from 'node:crypto';

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

export function createChatRouter({ chatService, conversationRepository, conversationDocumentRepository }) {
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

  router.post('/stream', async (request, response) => {
    const abortController = new AbortController();
    let aborted = false;

    request.on('close', () => {
      aborted = true;
      abortController.abort();
    });

    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const chatInfo = await chatService.chatStream({
        conversationId: request.body?.conversationId,
        message: request.body?.message,
        userId,
        signal: abortController.signal
      });

      if (!chatInfo) {
        return response.status(404).json({
          error: 'conversation_not_found',
          category: 'validation',
          message: 'Conversation not found.'
        });
      }

      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');

      const requestId = randomUUID();

      response.write(`data: ${JSON.stringify({ type: 'meta', requestId, conversationId: chatInfo.conversationId })}\n\n`);

      response.write(`data: ${JSON.stringify({ type: 'sources', sources: chatInfo.sources })}\n\n`);

      const heartbeat = setInterval(() => {
        if (aborted) {
          clearInterval(heartbeat);
          return;
        }
        try {
          response.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      let assistantContent = '';

      try {
        for await (const token of chatInfo.stream) {
          if (aborted) break;

          assistantContent += token;
          response.write(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`);
        }
      } catch (streamError) {
        clearInterval(heartbeat);

        if (aborted) {
          if (!response.headersSent) return;
          response.end();
          return;
        }

        const classified = classifyError(streamError);

        response.write(`data: ${JSON.stringify({ type: 'error', message: classified.message })}\n\n`);
        response.end();
        return;
      }

      clearInterval(heartbeat);

      if (aborted) {
        if (!response.headersSent) return;
        response.end();
        return;
      }

      response.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      response.end();

      if (assistantContent) {
        await conversationRepository.appendConversationTurnForUser({
          conversationId: chatInfo.conversationId,
          userId,
          userMessage: chatInfo.normalizedMessage,
          assistantMessage: assistantContent,
          assistantSources: chatInfo.sources
        });

        if (chatInfo.isNewConversation) {
          const title = chatInfo.normalizedMessage.trim();
          const truncatedTitle = title.length > 60
            ? title.slice(0, 60).replace(/\s+\S*$/, '')
            : title;

          await conversationRepository.updateConversationTitleForUser(
            chatInfo.conversationId,
            truncatedTitle || 'Untitled thread',
            userId
          );
        }
      }
    } catch (error) {
      if (aborted) {
        if (!response.headersSent) return;
        response.end();
        return;
      }

      if (response.headersSent) {
        try {
          response.write(`data: ${JSON.stringify({ type: 'error', message: 'chat_failed' })}\n\n`);
          response.end();
        } catch {
          // ignore write errors after headers sent
        }
        return;
      }

      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'chat_stream_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'chat_stream_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.post('/conversations', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const conversation = await conversationRepository.createConversation({ userId });

      return response.status(201).json(conversation);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_create_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_create_failed',
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

  router.patch('/conversations/:id', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const result = await chatService.renameConversation(
        request.params.id,
        userId,
        request.body?.title
      );

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
          error: 'conversation_rename_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_rename_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.delete('/conversations/:id', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const result = await chatService.deleteConversation(
        request.params.id,
        userId
      );

      if (!result) {
        return response.status(404).json({
          error: 'conversation_not_found',
          category: 'validation',
          message: 'Conversation not found.'
        });
      }

      return response.status(204).send();
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_delete_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_delete_failed',
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

  router.get('/conversations/:id/documents', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const documents = await conversationDocumentRepository.listByConversation(
        request.params.id,
        userId
      );

      return response.json(documents);
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_documents_list_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_documents_list_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.post('/conversations/:id/documents', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const { documentId } = request.body ?? {};

      if (!documentId || typeof documentId !== 'string') {
        return response.status(400).json({
          error: 'document_id_required',
          category: 'validation',
          message: 'documentId is required.'
        });
      }

      const result = await conversationDocumentRepository.attachDocument(
        request.params.id,
        documentId,
        userId
      );

      if (!result) {
        return response.status(400).json({
          error: 'attachment_failed',
          category: 'validation',
          message: 'Document could not be attached. It may already be attached, or the conversation or document could not be found.'
        });
      }

      return response.status(201).json({ success: true });
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_document_attach_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_document_attach_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.delete('/conversations/:id/documents/:documentId', async (request, response) => {
    try {
      const userId = authenticate(request, response);

      if (!userId) {
        return;
      }

      const removed = await conversationDocumentRepository.detachDocument(
        request.params.id,
        request.params.documentId,
        userId
      );

      if (!removed) {
        return response.status(404).json({
          error: 'not_found',
          category: 'validation',
          message: 'Attachment not found.'
        });
      }

      return response.status(204).send();
    } catch (error) {
      const classified = classifyError(error);

      if (classified.category === 'validation') {
        return response.status(400).json({
          error: 'conversation_document_detach_validation_failed',
          category: classified.category,
          message: classified.message
        });
      }

      return response.status(classified.statusCode).json({
        error: 'conversation_document_detach_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}