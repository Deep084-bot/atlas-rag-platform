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

const SUMMARY_CHAT_SYSTEM_INSTRUCTIONS = [
  'You are Atlas, a document analysis assistant.',
  'The user is asking you to summarize or describe a document.',
  'Based on the retrieved context chunks below, generate a comprehensive summary of the document.',
  'Cover the main topics, purpose, key points, and notable details found in the context.',
  'Use only the retrieved context for factual claims.',
  'If the retrieved context is empty or lacks sufficient information, reply exactly: insufficient context.',
  'Do NOT treat this as a question-answering task. Generate a summary of the document.'
].join(' ');

function isDocumentSummaryQuery(question) {
  const patterns = [
    /^tell\s+me\s+about\b/i,
    /^summarize\b/i,
    /^summarise\b/i,
    /^what\s+(is|does)\s+(this|the)\s+(document|file|pdf)\s+(about|cover|contain|say)/i,
    /^give\s+me\s+(a\s+)?summary/i,
    /^what\s+is\s+this\s+(document|file|pdf)\s+(about\s+)?\??$/i,
    /^can\s+you\s+(summarize|summarise|tell\s+me\s+about)\b/i,
  ];
  return patterns.some((re) => re.test(question));
}

function buildSummaryChatPrompt({ question, history, retrievedContext }) {
  const messages = [
    { role: 'system', content: SUMMARY_CHAT_SYSTEM_INSTRUCTIONS }
  ];

  for (const message of history) {
    messages.push({ role: message.role, content: message.content });
  }

  if (retrievedContext.length > 0) {
    messages.push({
      role: 'system',
      content: ['Retrieved context:', formatRetrievedContext(retrievedContext)].join('\n\n')
    });
  }

  messages.push({ role: 'user', content: question });

  return { messages };
}

const LOW_QUALITY_OCR_SYSTEM_INSTRUCTIONS = [
  'You are Atlas, a document analysis assistant.',
  'The user is asking about a document that was uploaded to this conversation.',
  'However, the extracted text from this document is too noisy, garbled, or incomplete to read reliably.',
  'Do NOT attempt to summarize or answer based on unreadable text.',
  'Respond with a brief message stating that the document was processed but the extracted text quality is insufficient to generate a reliable summary.',
  'Do NOT claim the document does not exist or that no documents were uploaded.'
].join(' ');

function buildLowQualityOcrPrompt({ question, history }) {
  const messages = [
    { role: 'system', content: LOW_QUALITY_OCR_SYSTEM_INSTRUCTIONS }
  ];

  for (const message of history) {
    messages.push({ role: message.role, content: message.content });
  }

  messages.push({ role: 'user', content: question });

  return { messages };
}

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
  documentsRepository,
  storageProvider,
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
      const shouldUseRag = sources.length > 0 && topSimilarity >= 0.50 && overlapCount >= 1;

      const isSummaryQuery = isDocumentSummaryQuery(normalizedMessage);
      const isSummary = isSummaryQuery && docCount > 0;

      if (sources.length > 0) {
        sources.forEach((chunk, index) => {
          console.log('[RAG CHUNK %d] fileName=%s similarity=%f text="%s"',
            index,
            chunk.fileName || '?',
            chunk.similarity || 0,
            (chunk.chunkText || '').slice(0, 300).replace(/\n/g, ' '));
        });
      }

      console.log('[atlas]', {
        query: normalizedMessage,
        topSimilarity,
        overlapCount,
        retrievedChunks: sources.length,
        mode: shouldUseRag ? 'rag' : 'fallback',
        summaryMode: isSummary
      });

      let prompt;
      let activeSources;

      if (shouldUseRag) {
        prompt = isSummary
          ? buildSummaryChatPrompt({ question: normalizedMessage, history, retrievedContext: sources })
          : buildChatPrompt({ question: normalizedMessage, history, retrievedContext: sources });
        activeSources = sources;
      } else if (isSummary) {
        prompt = buildLowQualityOcrPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      } else {
        prompt = buildFallbackChatPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      }

      if (prompt.messages) {
        const systemMsg = prompt.messages.find((m) => m.role === 'system');
        const userMsg = prompt.messages.find((m) => m.role === 'user');
        const contextMsgs = prompt.messages.filter((m) => m.role === 'system' && m.content.includes('[Chunk'));

        console.log('[SUMMARY PROMPT PREVIEW]');
        console.log('system:', (systemMsg?.content || '').slice(0, 500));
        console.log('user:', (userMsg?.content || '').slice(0, 500));
        console.log('contextBlocks:', contextMsgs.length);
        console.log('contextPreview:', (contextMsgs.map((m) => m.content).join('\n') || '').slice(0, 1000));
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
      const shouldUseRag = sources.length > 0 && topSimilarity >= 0.50 && overlapCount >= 1;

      const isSummaryQuery = isDocumentSummaryQuery(normalizedMessage);
      const isSummary = isSummaryQuery && docCount > 0;

      if (sources.length > 0) {
        sources.forEach((chunk, index) => {
          console.log('[RAG CHUNK %d] fileName=%s similarity=%f text="%s"',
            index,
            chunk.fileName || '?',
            chunk.similarity || 0,
            (chunk.chunkText || '').slice(0, 300).replace(/\n/g, ' '));
        });
      }

      console.log('[atlas]', {
        query: normalizedMessage,
        topSimilarity,
        overlapCount,
        retrievedChunks: sources.length,
        mode: shouldUseRag ? 'rag' : 'fallback',
        summaryMode: isSummary
      });

      let prompt;
      let activeSources;

      if (shouldUseRag) {
        prompt = isSummary
          ? buildSummaryChatPrompt({ question: normalizedMessage, history, retrievedContext: sources })
          : buildChatPrompt({ question: normalizedMessage, history, retrievedContext: sources });
        activeSources = sources;
      } else if (isSummary) {
        prompt = buildLowQualityOcrPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      } else {
        prompt = buildFallbackChatPrompt({
          question: normalizedMessage,
          history
        });
        activeSources = [];
      }

      if (prompt.messages) {
        const systemMsg = prompt.messages.find((m) => m.role === 'system');
        const userMsg = prompt.messages.find((m) => m.role === 'user');
        const contextMsgs = prompt.messages.filter((m) => m.role === 'system' && m.content.includes('[Chunk'));

        console.log('[SUMMARY PROMPT PREVIEW]');
        console.log('system:', (systemMsg?.content || '').slice(0, 500));
        console.log('user:', (userMsg?.content || '').slice(0, 500));
        console.log('contextBlocks:', contextMsgs.length);
        console.log('contextPreview:', (contextMsgs.map((m) => m.content).join('\n') || '').slice(0, 1000));
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

      const docs = await conversationDocumentRepository.listByConversation(normalizedConversationId, normalizedUserId);

      for (const doc of docs) {
        const count = await documentsRepository.countConversationsForDocument(doc.id);

        if (count <= 1) {
          const deleted = await documentsRepository.deleteDocumentByIdForUser(doc.id, normalizedUserId);

          if (deleted?.storage_path) {
            try {
              await storageProvider.deleteFile(deleted.storage_path);
            } catch (fileError) {
              console.warn('[deleteConversation] Failed to delete file for document %s: %s', doc.id, fileError instanceof Error ? fileError.message : fileError);
            }
          }
        }
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