export function collectPendingDocumentIds({
  documentIds = [],
  collectionIds = [],
  collections = [],
} = {}) {
  const ids = [];
  const seen = new Set();

  function add(documentId) {
    if (typeof documentId !== 'string' || documentId.length === 0 || seen.has(documentId)) {
      return;
    }

    seen.add(documentId);
    ids.push(documentId);
  }

  for (const documentId of documentIds ?? []) {
    add(documentId);
  }

  const selectedCollectionIds = new Set(collectionIds ?? []);

  for (const collection of collections ?? []) {
    if (!selectedCollectionIds.has(collection?.id)) continue;

    for (const documentId of collection.documentIds ?? []) {
      add(documentId);
    }
  }

  return ids;
}

export function pendingAttachmentDocuments({
  documentIds = [],
  collectionIds = [],
  collections = [],
  documents = [],
} = {}) {
  const pendingIds = new Set(
    collectPendingDocumentIds({ documentIds, collectionIds, collections }),
  );

  return (documents ?? []).filter((document) => pendingIds.has(document.id));
}

export function unattachedDocumentIds(documentIds = [], attachedDocuments = []) {
  const attachedIds = new Set((attachedDocuments ?? []).map((document) => document.id));

  return (documentIds ?? []).filter((documentId) => !attachedIds.has(documentId));
}

export function isDocumentAttachable(document) {
  return document?.status !== 'failed';
}

export function attachableDocuments(documents = []) {
  return (documents ?? []).filter(isDocumentAttachable);
}
