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