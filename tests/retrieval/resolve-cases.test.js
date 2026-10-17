import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildChunkIndex, resolveCase, resolveCases } from '../../scripts/dev/lib/resolve-cases.mjs';

const fixturePath = fileURLToPath(
  new URL('../../scripts/dev/fixtures/retrieval-eval-plan.json', import.meta.url)
);

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('buildChunkIndex maps each document to its chunks', () => {
  const index = buildChunkIndex(
    [{ id: 'd1', text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa '.repeat(40) }],
    { chunkSize: 100, overlap: 20 }
  );

  assert.equal(index.get('d1').length > 1, true);
  assert.equal(index.get('d1')[0].chunkIndex, 1);
});

test('resolveCase maps markers to concrete chunk indices', () => {
  const index = buildChunkIndex([{ id: 'd1', text: 'The return window is thirty days from delivery.' }]);

  const resolved = resolveCase(
    { id: 'c1', query: 'q', relevance: [{ documentId: 'd1', marker: 'thirty days', grade: 3 }] },
    index
  );

  assert.equal(resolved.relevance.length, 1);
  assert.equal(resolved.relevance[0].documentId, 'd1');
  assert.equal(resolved.relevance[0].chunkIndex, 1);
  assert.equal(resolved.relevance[0].grade, 3);
});

test('resolveCase keeps the maximum grade when markers share a chunk', () => {
  const index = buildChunkIndex([{ id: 'd1', text: 'alpha xyz beta tail' }]);

  const resolved = resolveCase(
    {
      id: 'c1',
      query: 'q',
      relevance: [
        { documentId: 'd1', marker: 'alpha', grade: 1 },
        { documentId: 'd1', marker: 'beta', grade: 3 }
      ]
    },
    index
  );

  assert.equal(resolved.relevance.length, 1);
  assert.equal(resolved.relevance[0].grade, 3);
});

test('resolveCase throws when a marker is missing', () => {
  const index = buildChunkIndex([{ id: 'd1', text: 'nothing here' }]);

  assert.throws(
    () => resolveCase({ id: 'c1', query: 'q', relevance: [{ documentId: 'd1', marker: 'absent text' }] }, index),
    /marker not found/
  );
});

test('resolveCase passes unanswerable cases through unchanged', () => {
  const index = buildChunkIndex([{ id: 'd1', text: 'x' }]);
  const resolved = resolveCase({ id: 'u1', kind: 'unanswerable', query: 'q', expectNoAnswer: true }, index);

  assert.equal(resolved.expectNoAnswer, true);
  assert.equal(resolved.relevance, undefined);
});

test('resolveCase supports legacy document/chunk fixtures', () => {
  const index = buildChunkIndex([
    { id: 'd1', text: 'a'.repeat(600) },
    { id: 'd2', text: 'b'.repeat(600) }
  ]);

  const resolved = resolveCase(
    { id: 'l1', query: 'q', expectedDocumentIds: ['d1', 'd2'], expectedChunkIndices: [1] },
    index
  );

  assert.equal(resolved.relevance.length, 2);
  assert.ok(resolved.relevance.every((entry) => entry.chunkIndex === 1));
});

test('proposed fixture resolves every case deterministically', () => {
  const resolved = resolveCases(fixture);
  const byId = new Map(resolved.map((entry) => [entry.id, entry]));

  assert.equal(resolved.length, fixture.cases.length);

  for (const entry of resolved) {
    if (entry.expectNoAnswer) {
      assert.equal(entry.relevance, undefined, `${entry.id} should be unanswerable`);
      continue;
    }

    assert.ok(entry.relevance.length >= 1, `${entry.id} resolved no relevance`);
    assert.ok(
      entry.relevance.every((rel) => Number.isInteger(rel.chunkIndex)),
      `${entry.id} produced a document-level (non-chunk) label`
    );
  }

  const crossChunk = byId.get('return-steps-and-refund-timing-cross-chunk');
  assert.ok(crossChunk.relevance.length >= 2);
  assert.ok([...new Set(crossChunk.relevance.map((rel) => rel.chunkIndex))].length >= 2);

  const ambiguous = byId.get('contact-support-ambiguous');
  const ambiguousDocs = new Set(ambiguous.relevance.map((rel) => rel.documentId));
  assert.ok(ambiguousDocs.size >= 2, 'ambiguous case should span multiple documents');

  assert.equal(byId.get('unanswerable-support-phone').expectNoAnswer, true);
});
