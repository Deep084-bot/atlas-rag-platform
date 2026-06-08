const SYSTEM_INSTRUCTIONS = [
  'You answer questions using only the retrieved context provided below.',
  'Use the retrieved context as the only source of factual claims.',
  'If the context does not fully support an answer, reply exactly: insufficient context.'
].join(' ');

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

const FALLBACK_SYSTEM_INSTRUCTIONS = [
  'You are Atlas.',
  "The user's uploaded documents do not contain relevant information for this question.",
  'Answer using your general knowledge.'
].join(' ');

export function buildGenerationPrompt({ question, retrievedContext }) {
  const contextBlock = formatRetrievedContext(retrievedContext);

  return {
    messages: [
      {
        role: 'system',
        content: SYSTEM_INSTRUCTIONS
      },
      {
        role: 'user',
        content: [
          `Question:\n${question}`,
          'Retrieved context:',
          contextBlock,
          'Answer the question using the retrieved context only.'
        ].join('\n\n')
      }
    ]
  };
}

export function buildFallbackPrompt({ question }) {
  return {
    messages: [
      { role: 'system', content: FALLBACK_SYSTEM_INSTRUCTIONS },
      { role: 'user', content: `Question:\n${question}` }
    ]
  };
}

export function buildFallbackChatPrompt({ question, history }) {
  const messages = [
    { role: 'system', content: FALLBACK_SYSTEM_INSTRUCTIONS }
  ];

  for (const message of history) {
    messages.push({ role: message.role, content: message.content });
  }

  messages.push({ role: 'user', content: question });

  return { messages };
}