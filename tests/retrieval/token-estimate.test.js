import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHARS_PER_TOKEN,
  estimateTokens,
  estimateCorpusDocumentTokens,
  estimateCaseQueryTokens,
  estimateEvaluationUsage
} from '../../scripts/dev/lib/token-estimate.mjs';

test('CHARS_PER_TOKEN is the documented heuristic', () => {
  assert.equal(CHARS_PER_TOKEN, 4);
});

test('estimateTokens rounds up and handles empty input', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test('estimateCorpusDocumentTokens sums document text', () => {
  const documents = [{ text: 'abcd' }, { text: 'abcdefgh' }, {}];
  assert.equal(estimateCorpusDocumentTokens(documents), 3);
});

test('estimateCaseQueryTokens sums query text', () => {
  const cases = [{ query: 'abcd' }, { query: 'abcdefgh' }];
  assert.equal(estimateCaseQueryTokens(cases), 3);
});

test('estimateEvaluationUsage excludes corpus re-embed unless requested', () => {
  const cases = [{ query: 'abcd' }, { query: 'abcd' }];
  const documents = [{ text: 'abcdefgh' }];

  const queryOnly = estimateEvaluationUsage({ cases, documents });
  assert.equal(queryOnly.caseCount, 2);
  assert.equal(queryOnly.queryTokens, 2);
  assert.equal(queryOnly.corpusTokens, 0);
  assert.equal(queryOnly.totalTokens, 2);
  assert.equal(queryOnly.requestsIfOneQueryPerRequest, 2);
  assert.equal(queryOnly.includeCorpusReEmbed, false);

  const withCorpus = estimateEvaluationUsage({ cases, documents, includeCorpusReEmbed: true });
  assert.equal(withCorpus.corpusTokens, 2);
  assert.equal(withCorpus.totalTokens, 4);
});
