import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_K,
  relevanceKey,
  toRelevanceMap,
  matchedRelevanceKey,
  gradeForItem,
  recallAtK,
  precisionAtK,
  hitAtK,
  reciprocalRank,
  dcgAtK,
  ndcgAtK,
  topSimilarity,
  mean,
  round,
  noAnswerSummary
} from '../../scripts/dev/lib/retrieval-metrics.mjs';

const item = (documentId, chunkIndex, similarity = 0.5) => ({ documentId, chunkIndex, similarity });

test('DEFAULT_K is five', () => {
  assert.equal(DEFAULT_K, 5);
});

test('relevanceKey treats null/undefined chunkIndex as document-level', () => {
  assert.equal(relevanceKey('d1', null), 'd1::*');
  assert.equal(relevanceKey('d1', undefined), 'd1::*');
  assert.equal(relevanceKey('d1', 3), 'd1::3');
});

test('toRelevanceMap supports graded relevance entries', () => {
  const map = toRelevanceMap({
    relevance: [
      { documentId: 'a', chunkIndex: 0, grade: 3 },
      { documentId: 'a', chunkIndex: 1, grade: 2 }
    ]
  });

  assert.equal(map.get('a::0'), 3);
  assert.equal(map.get('a::1'), 2);
});

test('toRelevanceMap supports legacy document + chunk cross product', () => {
  const map = toRelevanceMap({ expectedDocumentIds: ['a', 'b'], expectedChunkIndices: [0, 2] });

  assert.equal(map.size, 4);
  assert.equal(map.get('a::0'), 1);
  assert.equal(map.get('b::2'), 1);
});

test('toRelevanceMap keeps the maximum grade for duplicate chunk labels', () => {
  const map = toRelevanceMap({
    relevance: [
      { documentId: 'a', chunkIndex: 1, grade: 3 },
      { documentId: 'a', chunkIndex: 1, grade: 2 }
    ]
  });

  assert.equal(map.size, 1);
  assert.equal(map.get('a::1'), 3);
});

test('toRelevanceMap supports legacy document-only relevance', () => {
  const map = toRelevanceMap({ expectedDocumentIds: ['a'] });

  assert.equal(map.get('a::*'), 1);
});

test('document-level relevance matches any chunk of the document', () => {
  const map = toRelevanceMap({ expectedDocumentIds: ['a'] });

  assert.equal(matchedRelevanceKey({ documentId: 'a', chunkIndex: 7 }, map), 'a::*');
  assert.equal(gradeForItem({ documentId: 'a', chunkIndex: 7 }, map), 1);
});

test('recallAtK counts distinct relevant items found', () => {
  const map = toRelevanceMap({ relevance: [{ documentId: 'a', chunkIndex: 0 }, { documentId: 'a', chunkIndex: 9 }] });
  const retrieved = [
    { documentId: 'x', chunkIndex: 0 },
    { documentId: 'a', chunkIndex: 0 },
    { documentId: 'x', chunkIndex: 1 },
    { documentId: 'a', chunkIndex: 9 }
  ];

  assert.equal(recallAtK(retrieved, map, 5), 1);
  assert.equal(recallAtK(retrieved, map, 2), 0.5);
  assert.equal(recallAtK(retrieved, map, 1), 0);
});

test('recallAtK returns null when there is nothing relevant', () => {
  assert.equal(recallAtK([{ documentId: 'x', chunkIndex: 0 }], new Map(), 5), null);
});

test('precisionAtK divides by the window size actually returned', () => {
  const map = toRelevanceMap({ relevance: [{ documentId: 'a', chunkIndex: 0 }] });
  const retrieved = [
    { documentId: 'a', chunkIndex: 0 },
    { documentId: 'x', chunkIndex: 0 },
    { documentId: 'x', chunkIndex: 1 }
  ];

  assert.equal(precisionAtK(retrieved, map, 5), 1 / 3);
  assert.equal(precisionAtK([], map, 5), null);
});

test('hitAtK and reciprocalRank reflect first relevant position', () => {
  const map = toRelevanceMap({ relevance: [{ documentId: 'a', chunkIndex: 0 }] });
  const retrieved = [
    { documentId: 'x', chunkIndex: 0 },
    { documentId: 'a', chunkIndex: 0 }
  ];

  assert.equal(hitAtK(retrieved, map, 5), true);
  assert.equal(hitAtK(retrieved, map, 1), false);
  assert.equal(reciprocalRank(retrieved, map), 0.5);
  assert.equal(reciprocalRank([{ documentId: 'x', chunkIndex: 0 }], map), 0);
});

test('ndcgAtK equals 1 for an ideal ordering and penalises missing high grades', () => {
  const map = toRelevanceMap({
    relevance: [
      { documentId: 'a', chunkIndex: 1, grade: 3 },
      { documentId: 'a', chunkIndex: 2, grade: 2 },
      { documentId: 'a', chunkIndex: 3, grade: 1 }
    ]
  });

  const ideal = [
    { documentId: 'a', chunkIndex: 1 },
    { documentId: 'a', chunkIndex: 2 },
    { documentId: 'a', chunkIndex: 3 }
  ];
  const shuffled = [
    { documentId: 'a', chunkIndex: 1 },
    { documentId: 'x', chunkIndex: 0 },
    { documentId: 'a', chunkIndex: 2 }
  ];

  assert.equal(ndcgAtK(ideal, map, 3), 1);
  assert.ok(ndcgAtK(shuffled, map, 3) > 0.9 && ndcgAtK(shuffled, map, 3) < 0.91);
});

test('dcgAtK uses graded gains with log2 discount', () => {
  const map = toRelevanceMap({ relevance: [{ documentId: 'a', chunkIndex: 0, grade: 3 }] });

  assert.equal(dcgAtK([{ documentId: 'a', chunkIndex: 0 }], map, 1), 7);
});

test('topSimilarity returns first similarity or zero', () => {
  assert.equal(topSimilarity([{ similarity: 0.42 }, { similarity: 0.1 }]), 0.42);
  assert.equal(topSimilarity([]), 0);
});

test('mean and round ignore non-finite values', () => {
  assert.equal(mean([1, null, 3, NaN]), 2);
  assert.equal(mean([]), null);
  assert.equal(round(0.123456), 0.1235);
  assert.equal(round(Infinity), null);
});

test('noAnswerSummary measures separability and threshold false positives', () => {
  const summary = noAnswerSummary({
    noAnswerTop1: [0.3, 0.4],
    answerableTop1: [0.5, 0.9],
    threshold: 0.5
  });

  assert.equal(summary.count, 2);
  assert.equal(summary.maxNoAnswer, 0.4);
  assert.equal(summary.minAnswerable, 0.5);
  assert.equal(summary.margin, 0.1);
  assert.equal(summary.separated, true);
  assert.equal(summary.falsePositiveRate, 0);

  const overlapping = noAnswerSummary({
    noAnswerTop1: [0.3, 0.4],
    answerableTop1: [0.5, 0.9],
    threshold: 0.35
  });

  assert.equal(overlapping.falsePositiveRate, 0.5);

  const inseparable = noAnswerSummary({ noAnswerTop1: [0.6], answerableTop1: [0.5] });
  assert.equal(inseparable.separated, false);
  assert.equal(inseparable.margin, -0.1);
});
