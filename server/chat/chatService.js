import { ValidationError } from '../errors.js';
import { buildFallbackChatPrompt } from '../generation/promptBuilder.js';

function computeOverlap(question, chunks) {
  const normalizedQuestion = question.toLowerCase().replace(/[^\w\s]/g, ' ');
  const contextText = chunks
    .map((c) => [c.fileName, c.chunkText].join(' '))
    .join(' ')
    .toLowerCase();
  const questionTerms = normalizedQuestion.split(/\s+/).filter((w) => w.length >= 4);
  return questionTerms.filter((word) => contextText.includes(word)).length;
}

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
  conversationDocumentRepository,
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

      const docCount = await conversationDocumentRepository.countByConversation(conversation.id, normalizedUserId);

      let sources = [];

      if (docCount > 0) {
        const retrieval = await retrievalService.retrieve(normalizedMessage, {
          topK: parsePositiveInteger(retrievalTopK, 6),
          similarityThreshold,
          userId: normalizedUserId,
          conversationId: conversation.id
        });

        sources = retrieval.retrievedContext ?? [];
      }

      const topSimilarity = sources.length > 0 ? sources[0].similarity : 0;
      const overlapCount = sources.length > 0 ? computeOverlap(normalizedMessage, sources) : 0;
      const shouldUseRag = sources.length > 0 && topSimilarity >= 0.55 && overlapCount >= 1;

      console.log('[atlas]', {
        query: normalizedMessage,
        topSimilarity,
        overlapCount,
        retrievedChunks: sources.length,
        mode: shouldUseRag ? 'rag' : 'fallback'
      });

      let prompt;
      let activeSources;

      if (shouldUseRag) {
        prompt = buildChatPrompt({
          question: normalizedMessage,
          history,
          retrievedContext: sources
        });
        activeSources = sources;
      } else {
        prompt = buildFallbackChatPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      }

      const generation = await generationService.generateFromPrompt({
        prompt,
        sources: activeSources
      });

      await conversationRepository.appendConversationTurnForUser({
        conversationId: conversation.id,
        userId: normalizedUserId,
        userMessage: normalizedMessage,
        assistantMessage: generation.answer,
        assistantSources: activeSources,
      });

      if (conversation.title === UNTITLED_THREAD) {
        const title = generateTitle(normalizedMessage);
        await conversationRepository.updateConversationTitleForUser(conversation.id, title, normalizedUserId);
      }

      return {
        conversationId: conversation.id,
        answer: generation.answer,
        sources: activeSources
      };
    },

    async chatStream({ conversationId, message, userId, signal } = {}) {
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

      const docCount = await conversationDocumentRepository.countByConversation(conversation.id, normalizedUserId);

      let sources = [];

      if (docCount > 0) {
        const retrieval = await retrievalService.retrieve(normalizedMessage, {
          topK: parsePositiveInteger(retrievalTopK, 6),
          similarityThreshold,
          userId: normalizedUserId,
          conversationId: conversation.id
        });

        sources = retrieval.retrievedContext ?? [];
      }

      const topSimilarity = sources.length > 0 ? sources[0].similarity : 0;
      const overlapCount = sources.length > 0 ? computeOverlap(normalizedMessage, sources) : 0;
      const shouldUseRag = sources.length > 0 && topSimilarity >= 0.55 && overlapCount >= 1;

      console.log('[atlas]', {
        query: normalizedMessage,
        topSimilarity,
        overlapCount,
        retrievedChunks: sources.length,
        mode: shouldUseRag ? 'rag' : 'fallback'
      });

      let prompt;
      let activeSources;

      if (shouldUseRag) {
        prompt = buildChatPrompt({
          question: normalizedMessage,
          history,
          retrievedContext: sources
        });
        activeSources = sources;
      } else {
        prompt = buildFallbackChatPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      }

      const stream = generationService.generateStreamFromPrompt({
        prompt,
        sources: activeSources,
        signal
      });

      return {
        conversationId: conversation.id,
        sources: activeSources,
        isNewConversation: conversation.title === UNTITLED_THREAD,
        normalizedMessage,
        stream
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

      return await conversationRepository.updateConversationTitleForUser(normalizedConversationId, normalizedTitle, normalizedUserId);
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

      return await conversationRepository.deleteConversationForUser(normalizedConversationId, normalizedUserId);
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