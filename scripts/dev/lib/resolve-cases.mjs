import { chunkText } from '../../../server/ingestion/chunkText.js';

/**
 * Offline, deterministic resolver that turns marker-labelled evaluation cases
 * into concrete (documentId, chunkIndex, grade) relevance pairs. Mirrors the
 * marker-resolution the seeder performs, but without touching a database, so the
 * proposed dataset can be validated and budgeted before anything is seeded.
 */

export function buildChunkIndex(documents = [], chunking = {}) {
  const index = new Map();

  for (const document of documents) {
    const chunks = chunkText(document.text, chunking).map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      content: chunk.content
    }));
    index.set(document.id, chunks);
  }

  return index;
}

function legacyEntries(testCase) {
  const documents = testCase.expectedDocumentIds
    ?? (testCase.expectedDocumentId ? [testCase.expectedDocumentId] : []);
  const chunks = testCase.expectedChunkIndices ?? [];
  const entries = [];

  if (chunks.length > 0) {
    for (const documentId of documents) {
      for (const chunkIndex of chunks) {
        entries.push({ documentId, chunkIndex, grade: 1 });
      }
    }
    return entries;
  }

  for (const documentId of documents) {
    entries.push({ documentId, grade: 1 });
  }

  return entries;
}

export function resolveCase(testCase, chunkIndex) {
  if (testCase.expectNoAnswer) {
    return {
      id: testCase.id ?? null,
      kind: testCase.kind ?? null,
      query: testCase.query,
      expectNoAnswer: true,
      maxSimilarity: testCase.maxSimilarity ?? null
    };
  }

  const source = Array.isArray(testCase.relevance) && testCase.relevance.length > 0
    ? testCase.relevance
    : legacyEntries(testCase);

  const resolved = [];

  for (const entry of source) {
    if (entry.chunkIndex !== undefined && entry.chunkIndex !== null) {
      resolved.push({ documentId: entry.documentId, chunkIndex: entry.chunkIndex, grade: entry.grade ?? 1 });
      continue;
    }

    const documentIds = entry.documentId ? [entry.documentId] : [...chunkIndex.keys()];

    for (const documentId of documentIds) {
      const chunks = chunkIndex.get(documentId) ?? [];

      if (entry.marker) {
        const matches = chunks.filter((chunk) => chunk.content.includes(entry.marker));

        if (matches.length === 0) {
          throw new Error(`Case "${testCase.id}": marker not found in ${documentId}: "${entry.marker}"`);
        }

        for (const match of matches) {
          resolved.push({ documentId, chunkIndex: match.chunkIndex, grade: entry.grade ?? 1 });
        }
      } else {
        resolved.push({ documentId, chunkIndex: null, grade: entry.grade ?? 1 });
      }
    }
  }

  const byKey = new Map();

  for (const entry of resolved) {
    const key = `${entry.documentId}::${entry.chunkIndex ?? '*'}`;
    const existing = byKey.get(key);
    if (!existing || entry.grade > existing.grade) {
      byKey.set(key, entry);
    }
  }

  return {
    id: testCase.id ?? null,
    kind: testCase.kind ?? null,
    query: testCase.query,
    relevance: [...byKey.values()]
  };
}

export function resolveCases({ documents = [], cases = [], chunking = {} } = {}) {
  const chunkIndex = buildChunkIndex(documents, chunking);
  return cases.map((testCase) => resolveCase(testCase, chunkIndex));
}
