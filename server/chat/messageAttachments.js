export function parseDocumentIds(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const ids = [];

  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      return null;
    }

    const id = item.trim();

    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

export function toMessageAttachment(document) {
  return {
    id: document.id,
    fileName: document.fileName ?? 'Document',
    fileType: document.fileType ?? null,
  };
}

export function selectMessageAttachments(conversationDocuments, requestedIds) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
    return [];
  }

  const documentsById = new Map(
    (Array.isArray(conversationDocuments) ? conversationDocuments : [])
      .filter((document) => document?.id)
      .map((document) => [document.id, document]),
  );

  return requestedIds.flatMap((documentId) => {
    const document = documentsById.get(documentId);
    return document ? [toMessageAttachment(document)] : [];
  });
}
