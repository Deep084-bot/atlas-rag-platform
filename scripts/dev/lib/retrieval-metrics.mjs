/**
 * Pure, dependency-free retrieval evaluation metrics.
 *
 * Kept free of I/O, providers, and database access so it can be unit-tested
 * deterministically and reused by offline comparisons. A "retrieved item" is any
 * object shaped `{ documentId, chunkIndex, similarity }`; a case definition
 * supplies the relevance labels.
 *
 * Relevance model
 * ---------------
 * A case's relevant items are expressed either as graded entries:
 *   relevance: [{ documentId, chunkIndex?, grade }]
 * or, for backward compatibility with the existing staging fixtures:
 *   { expectedDocumentIds: [...], expectedChunkIndices: [...] }
 * In the legacy form every listed document (and, when present, each document x
 * chunk pair) is treated as grade 1. A document-level entry matches any chunk of
 * that document.
 */

export const DEFAULT_K = 5;

export function relevanceKey(documentId, chunkIndex) {
  return chunkIndex === undefined || chunkIndex === null
    ? `${documentId}::*`
    : `${documentId}::${chunkIndex}`;
}

export function toRelevanceMap(caseDef = {}) {
  const map = new Map();

  if (Array.isArray(caseDef.relevance) && caseDef.relevance.length > 0) {
    for (const entry of caseDef.relevance) {
      if (!entry || !entry.documentId) {
        continue;
      }
      const key = relevanceKey(entry.documentId, entry.chunkIndex);
      const grade = entry.grade ?? 1;
      map.set(key, Math.max(map.get(key) ?? 0, grade));
    }
    return map;
  }

  const documents = caseDef.expectedDocumentIds
    ?? (caseDef.expectedDocumentId ? [caseDef.expectedDocumentId] : []);
  const chunks = caseDef.expectedChunkIndices ?? [];

  if (chunks.length > 0 && documents.length > 0) {
    for (const documentId of documents) {
      for (const chunkIndex of chunks) {
        map.set(relevanceKey(documentId, chunkIndex), 1);
      }
    }
    return map;
  }

  for (const documentId of documents) {
    map.set(relevanceKey(documentId), 1);
  }

  return map;
}

export function matchedRelevanceKey(item, relevanceMap) {
  const exact = relevanceKey(item?.documentId, item?.chunkIndex);
  if (relevanceMap.has(exact)) {
    return exact;
  }

  const documentLevel = relevanceKey(item?.documentId);
  if (relevanceMap.has(documentLevel)) {
    return documentLevel;
  }

  return null;
}

export function gradeForItem(item, relevanceMap) {
  const key = matchedRelevanceKey(item, relevanceMap);
  return key === null ? 0 : (relevanceMap.get(key) ?? 0);
}

export function recallAtK(retrieved = [], relevanceMap, k = DEFAULT_K) {
  if (relevanceMap.size === 0) {
    return null;
  }

  const found = new Set();

  for (const item of retrieved.slice(0, k)) {
    const key = matchedRelevanceKey(item, relevanceMap);
    if (key !== null) {
      found.add(key);
    }
  }

  return found.size / relevanceMap.size;
}

export function precisionAtK(retrieved = [], relevanceMap, k = DEFAULT_K) {
  const window = retrieved.slice(0, k);

  if (window.length === 0) {
    return null;
  }

  const relevant = window.filter((item) => matchedRelevanceKey(item, relevanceMap) !== null).length;

  return relevant / window.length;
}

export function hitAtK(retrieved = [], relevanceMap, k = DEFAULT_K) {
  return retrieved.slice(0, k).some((item) => matchedRelevanceKey(item, relevanceMap) !== null);
}

export function reciprocalRank(retrieved = [], relevanceMap) {
  for (let index = 0; index < retrieved.length; index += 1) {
    if (matchedRelevanceKey(retrieved[index], relevanceMap) !== null) {
      return 1 / (index + 1);
    }
  }

  return 0;
}

export function dcgAtK(retrieved = [], relevanceMap, k = DEFAULT_K) {
  let dcg = 0;
  const window = retrieved.slice(0, k);

  for (let index = 0; index < window.length; index += 1) {
    const grade = gradeForItem(window[index], relevanceMap);
    dcg += ((2 ** grade) - 1) / Math.log2(index + 2);
  }

  return dcg;
}

export function ndcgAtK(retrieved = [], relevanceMap, k = DEFAULT_K) {
  const idealGrades = [...relevanceMap.values()].sort((a, b) => b - a).slice(0, k);

  if (idealGrades.length === 0) {
    return null;
  }

  let idcg = 0;
  for (let index = 0; index < idealGrades.length; index += 1) {
    idcg += ((2 ** idealGrades[index]) - 1) / Math.log2(index + 2);
  }

  if (idcg === 0) {
    return null;
  }

  return dcgAtK(retrieved, relevanceMap, k) / idcg;
}

export function topSimilarity(retrieved = []) {
  return retrieved.length > 0 ? Number(retrieved[0]?.similarity ?? 0) : 0;
}

export function mean(values = []) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (numeric.length === 0) {
    return null;
  }
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

export function round(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * No-answer behavior is measured by separability from answerable queries rather
 * than an absolute cosine threshold, because cosine scales are not comparable
 * across embedding spaces.
 *
 * @param {{
 *   noAnswerTop1?: number[],
 *   answerableTop1?: number[],
 *   threshold?: number|null
 * }} input
 */
export function noAnswerSummary({ noAnswerTop1 = [], answerableTop1 = [], threshold = null } = {}) {
  const maxNoAnswer = noAnswerTop1.length > 0 ? Math.max(...noAnswerTop1) : null;
  const minAnswerable = answerableTop1.length > 0 ? Math.min(...answerableTop1) : null;
  const margin = maxNoAnswer !== null && minAnswerable !== null ? minAnswerable - maxNoAnswer : null;
  const separated = margin !== null ? margin > 0 : null;

  const falsePositiveRate = threshold !== null && noAnswerTop1.length > 0
    ? noAnswerTop1.filter((value) => value >= threshold).length / noAnswerTop1.length
    : null;

  return {
    count: noAnswerTop1.length,
    maxNoAnswer: round(maxNoAnswer),
    meanNoAnswer: round(mean(noAnswerTop1)),
    minAnswerable: round(minAnswerable),
    margin: round(margin),
    separated,
    threshold,
    falsePositiveRate: round(falsePositiveRate)
  };
}
