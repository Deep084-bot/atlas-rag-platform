function toAttachment(document) {
  if (!document || typeof document.id !== 'string' || !document.id.trim()) {
    return null;
  }

  return {
    id: document.id.trim(),
    fileName: typeof document.fileName === 'string' && document.fileName.trim()
      ? document.fileName
      : 'Document',
    fileType: typeof document.fileType === 'string' ? document.fileType : null,
  };
}

export function snapshotMessageAttachments(documents = []) {
  if (!Array.isArray(documents)) {
    return [];
  }

  const seen = new Set();
  const attachments = [];

  for (const document of documents) {
    const attachment = toAttachment(document);

    if (!attachment || seen.has(attachment.id)) continue;

    seen.add(attachment.id);
    attachments.push(attachment);
  }

  return attachments;
}

export function normalizeMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.citations ?? message.sources ?? [],
    attachments: snapshotMessageAttachments(message.attachments),
    createdAt: message.createdAt,
    conversationId: message.conversationId ?? message.threadId,
  };
}
