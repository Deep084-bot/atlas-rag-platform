import { ValidationError } from '../errors.js';

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

    if (!Array.isArray(sources) || sources.length === 0) {
      return {
        answer: 'insufficient context',
        sources: []
      };
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
    async generate(question) {
      const normalizedQuestion = typeof question === 'string' ? question.trim() : '';

      if (!normalizedQuestion) {
        throw new ValidationError('question is required.');
      }

      const requestedTopK = parsePositiveInteger(defaultTopK, 6);
      const effectiveTopK = Math.min(requestedTopK, maxTopK);
      const effectiveThreshold = parseNumber(defaultSimilarityThreshold, 0.5);
      const retrieval = await retrievalService.retrieve(normalizedQuestion, {
        topK: effectiveTopK,
        similarityThreshold: effectiveThreshold
      });

      const sources = retrieval.retrievedContext ?? [];
      const prompt = buildPrompt({
        question: retrieval.query,
        retrievedContext: sources
      });
      return generateFromPrompt({ prompt, sources });
    },

    async generateFromPrompt({ prompt, sources = [], temperature: overrideTemperature, maxTokens: overrideMaxTokens } = {}) {
      return generateFromPrompt({
        prompt,
        sources,
        temperature: overrideTemperature,
        maxTokens: overrideMaxTokens
      });
    }
  };
}