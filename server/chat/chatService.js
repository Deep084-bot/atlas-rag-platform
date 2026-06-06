import { ValidationError } from '../errors.js';

const UNTITLED_THREAD = 'Untitled thread';

function generateTitle(message) {
  let title = message.trim();
  title = title.replace(/[.!?,;:]+$/u, '');

  if (title.length > 60) {
    const truncated = title.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace >= 40) {
      title = truncated.slice(0, lastSpace);
    } else {
      title = truncated;
    }
  }

  return title.trim();
}

const CHAT_SYSTEM_INSTRUCTIONS = [
  'You are Atlas, a conversational assistant for this document system.',
  'Use the conversation history to resolve follow-up questions and pronouns.',
  'Use only the retrieved context for factual claims.',
  'If the retrieved context does not support the answer, reply exactly: insufficient context.'
].join(' ');

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function formatRetrievedContext(retrievedContext) {
  return retrievedContext
    .map((chunk, index) => {
      const entryNumber = index + 1;

      return [
        `[Chunk ${entryNumber}]`,
        `chunkId: ${chunk.chunkId}`,
        `documentId: ${chunk.documentId}`,
        `chunkIndex: ${chunk.chunkIndex}`,
        `similarity: ${chunk.similarity}`,
        'chunkText:',
        chunk.chunkText,
        `[End Chunk ${entryNumber}]`
      ].join('\n');
    })
    .join('\n\n');
}

function buildChatPrompt({ question, history, retrievedContext }) {
  const messages = [
    {
      role: 'system',
      content: CHAT_SYSTEM_INSTRUCTIONS
    }
  ];

  for (const message of history) {
    messages.push({
      role: message.role,
      content: message.content
    });
  }

  if (retrievedContext.length > 0) {
    messages.push({
      role: 'system',
      content: ['Retrieved context:', formatRetrievedContext(retrievedContext)].join('\n\n')
    });
  }

  messages.push({
    role: 'user',
    content: question
  });

  return { messages };
}

export function createChatService({
  conversationRepository,
  retrievalService,
  generationService,
  historyLimit = 6,
  retrievalTopK = 6,
  similarityThreshold = 0.5
}) {
  return {
    async chat({ conversationId, message, userId } = {}) {
      const normalizedMessage = typeof message === 'string' ? message.trim() : '';

      if (!normalizedMessage) {
        throw new ValidationError('message is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
      let conversation = null;

      if (normalizedConversationId) {
        conversation = await conversationRepository.getConversationByIdForUser(normalizedConversationId, normalizedUserId);

        if (!conversation) {
          return null;
        }
      } else {
        conversation = await conversationRepository.createConversation({ userId: normalizedUserId });
      }

      const history = normalizedConversationId
        ? await conversationRepository.listRecentMessagesForUser(conversation.id, normalizedUserId, parsePositiveInteger(historyLimit, 6))
        : [];

      const retrieval = await retrievalService.retrieve(normalizedMessage, {
        topK: parsePositiveInteger(retrievalTopK, 6),
        similarityThreshold,
        userId: normalizedUserId
      });

      const sources = retrieval.retrievedContext ?? [];
      const prompt = buildChatPrompt({
        question: normalizedMessage,
        history,
        retrievedContext: sources
      });

      const generation = await generationService.generateFromPrompt({
        prompt,
        sources
      });

      await conversationRepository.appendConversationTurn({
        conversationId: conversation.id,
        userMessage: normalizedMessage,
        assistantMessage: generation.answer,
        assistantSources: sources,
        userId: normalizedUserId
      });

      if (conversation.title === UNTITLED_THREAD) {
        const title = generateTitle(normalizedMessage);
        await conversationRepository.updateConversationTitle(conversation.id, title);
      }

      return {
        conversationId: conversation.id,
        answer: generation.answer,
        sources
      };
    },

    async renameConversation(conversationId, userId, title) {
      const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';

      if (!normalizedConversationId) {
        throw new ValidationError('conversationId is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const normalizedTitle = typeof title === 'string' ? title.trim() : '';

      if (!normalizedTitle) {
        throw new ValidationError('title is required.');
      }

      if (normalizedTitle.length > 100) {
        throw new ValidationError('title must be 100 characters or fewer.');
      }

      const conversation = await conversationRepository.getConversationByIdForUser(normalizedConversationId, normalizedUserId);

      if (!conversation) {
        return null;
      }

      return await conversationRepository.updateConversationTitle(normalizedConversationId, normalizedTitle);
    },

    async deleteConversation(conversationId, userId) {
      const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';

      if (!normalizedConversationId) {
        throw new ValidationError('conversationId is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const conversation = await conversationRepository.getConversationByIdForUser(normalizedConversationId, normalizedUserId);

      if (!conversation) {
        return null;
      }

      return await conversationRepository.deleteConversation(normalizedConversationId);
    },

    async listConversations(userId) {
      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      return await conversationRepository.listConversationsForUser(normalizedUserId);
    },

    async getConversationMessages(conversationId, userId) {
      const normalizedConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';

      if (!normalizedConversationId) {
        throw new ValidationError('conversationId is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const conversation = await conversationRepository.getConversationByIdForUser(normalizedConversationId, normalizedUserId);

      if (!conversation) {
        return null;
      }

      return await conversationRepository.getMessagesByConversationId(normalizedConversationId);
    }
  };
}