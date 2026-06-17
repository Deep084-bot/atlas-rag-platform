import { ValidationError } from '../errors.js';
import { buildFallbackPrompt } from './promptBuilder.js';

function computeOverlap(question, chunks) {
  const normalizedQuestion = question.toLowerCase().replace(/[^\w\s]/g, ' ');
  const contextText = chunks
    .map((c) => [c.fileName, c.chunkText].join(' '))
    .join(' ')
    .toLowerCase();
  const questionTerms = normalizedQuestion.split(/\s+/).filter((w) => w.length >= 4);
  return questionTerms.filter((word) => contextText.includes(word)).length;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

export function createGenerationService({
  retrievalService,
  generationProvider,
  buildPrompt,
  defaultTopK = 6,
  maxTopK = 12,
  defaultSimilarityThreshold = 0.5,
  temperature = 0,
  maxTokens = 512
}) {
  async function generateFromPrompt({ prompt, sources = [], temperature: overrideTemperature, maxTokens: overrideMaxTokens } = {}) {
    if (!prompt || !Array.isArray(prompt.messages) || prompt.messages.length === 0) {
      throw new Error('prompt is required.');
    }

    const generation = await generationProvider.generate({
      ...prompt,
      temperature: overrideTemperature ?? temperature,
      maxTokens: overrideMaxTokens ?? maxTokens,
      metadata: {
        sourceCount: sources.length
      }
    });
    const answer = typeof generation.answerText === 'string' ? generation.answerText.trim() : '';

    if (!answer) {
      throw new Error('Generation provider returned an empty answer.');
    }

    return {
      answer,
      sources
    };
  }

  return {
    async generate(question, { userId } = {}) {
      const normalizedQuestion = typeof question === 'string' ? question.trim() : '';

      if (!normalizedQuestion) {
        throw new ValidationError('question is required.');
      }

      const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

      if (!normalizedUserId) {
        throw new ValidationError('userId is required.');
      }

      const requestedTopK = parsePositiveInteger(defaultTopK, 6);
      const effectiveTopK = Math.min(requestedTopK, maxTopK);
      const effectiveThreshold = parseNumber(defaultSimilarityThreshold, 0.5);
      const retrieval = await retrievalService.retrieve(normalizedQuestion, {
        topK: effectiveTopK,
        similarityThreshold: effectiveThreshold,
        userId: normalizedUserId
      });

      const sources = retrieval.retrievedContext ?? [];
      const topSimilarity = sources.length > 0 ? sources[0].similarity : 0;
      const overlapCount = sources.length > 0 ? computeOverlap(retrieval.query, sources) : 0;
      const shouldUseRag = sources.length > 0 && topSimilarity >= 0.50 && overlapCount >= 1;

      console.log('[atlas]', {
        query: retrieval.query,
        topSimilarity,
        overlapCount,
        retrievedChunks: sources.length,
        mode: shouldUseRag ? 'rag' : 'fallback'
      });

      if (shouldUseRag) {
        const prompt = buildPrompt({
          question: retrieval.query,
          retrievedContext: sources
        });
        return generateFromPrompt({ prompt, sources });
      }

      const prompt = buildFallbackPrompt({ question: retrieval.query });
      return generateFromPrompt({ prompt, sources: [] });
    },

    async generateFromPrompt({ prompt, sources = [], temperature: overrideTemperature, maxTokens: overrideMaxTokens } = {}) {
      return generateFromPrompt({
        prompt,
        sources,
        temperature: overrideTemperature,
        maxTokens: overrideMaxTokens
      });
    },

    generateStreamFromPrompt({ prompt, sources = [], temperature: overrideTemperature, maxTokens: overrideMaxTokens, signal } = {}) {
      if (!prompt || !Array.isArray(prompt.messages) || prompt.messages.length === 0) {
        throw new Error('prompt is required.');
      }

      return generationProvider.generateStream({
        ...prompt,
        temperature: overrideTemperature ?? temperature,
        maxTokens: overrideMaxTokens ?? maxTokens,
        signal
      });
    }
  };
}