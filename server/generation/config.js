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

export function createGenerationConfig(env = process.env) {
  return {
    providerName: (env.GENERATION_PROVIDER ?? 'groq').toLowerCase(),
    groqApiKey: env.GROQ_API_KEY ?? '',
    groqModel: env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    groqBaseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    retrievalTopK: parsePositiveInteger(env.GENERATION_TOP_K, 6),
    retrievalSimilarityThreshold: parseNumber(env.GENERATION_SIMILARITY_THRESHOLD, 0.5),
    temperature: parseNumber(env.GROQ_TEMPERATURE, 0),
    maxTokens: parsePositiveInteger(env.GROQ_MAX_TOKENS, 512)
  };
}