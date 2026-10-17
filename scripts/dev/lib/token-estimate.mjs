/**
 * Coarse, offline token estimation. This is a heuristic (about four characters
 * per token for English) used to budget Voyage API usage *before* any live call.
 * It is deliberately conservative and must not be presented as a measured count;
 * real usage comes from `VoyageProvider.getUsageSnapshot()` after a run.
 */

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return 0;
  }

  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateCorpusDocumentTokens(documents = []) {
  return documents.reduce((sum, document) => sum + estimateTokens(document?.text), 0);
}

export function estimateCaseQueryTokens(cases = []) {
  return cases.reduce((sum, testCase) => sum + estimateTokens(testCase?.query), 0);
}

/**
 * Estimate the Voyage usage for one evaluation pass.
 *
 * @param {{
 *   cases?: Array<{ query?: string, kind?: string }>,
 *   documents?: Array<{ text?: string }>,
 *   includeCorpusReEmbed?: boolean
 * }} input
 */
export function estimateEvaluationUsage({ cases = [], documents = [], includeCorpusReEmbed = false } = {}) {
  const queryTokens = estimateCaseQueryTokens(cases);
  const corpusTokens = includeCorpusReEmbed ? estimateCorpusDocumentTokens(documents) : 0;

  return {
    caseCount: cases.length,
    queryTokens,
    corpusTokens,
    totalTokens: queryTokens + corpusTokens,
    requestsIfOneQueryPerRequest: cases.length,
    includeCorpusReEmbed,
    note: 'Heuristic estimate (~4 chars/token). Not a substitute for reported usage.'
  };
}
