import { requestJson } from './client.js';

export async function uploadDocument({ file, userId }) {
  const formData = new FormData();
  formData.append('file', file);

  if (userId) {
    formData.append('userId', userId);
  }

  return requestJson('/api/documents/upload', {
    method: 'POST',
    body: formData
  });
}

export async function listDocuments() {
  return requestJson('/api/documents');
}

export async function getDocument(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`);
}

export async function getDocumentStatus(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}/status`);
}

export async function chunkDocument(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}/chunk`, {
    method: 'POST'
  });
}

export async function embedDocument(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}/embed`, {
    method: 'POST'
  });
}

export async function searchAtlas({ query, limit }) {
  return requestJson('/api/search', {
    method: 'POST',
    body: { query, limit }
  });
}

export async function generateAnswer({ question }) {
  return requestJson('/api/generate', {
    method: 'POST',
    body: { question }
  });
}

export async function sendChatMessage({ conversationId, message }) {
  return requestJson('/api/chat', {
    method: 'POST',
    body: {
      conversationId: conversationId || undefined,
      message
    }
  });
}

export async function listConversations() {
  return requestJson('/api/chat/conversations');
}

export async function getConversationMessages(conversationId) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
}