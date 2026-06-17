import { requestJson } from './client.js';

export async function uploadDocument({ file, userId, conversationId }) {
  const formData = new FormData();
  formData.append('file', file);

  if (userId) {
    formData.append('userId', userId);
  }

  if (conversationId) {
    formData.append('conversationId', conversationId);
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

export async function deleteDocument(documentId) {
  return requestJson(`/api/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE'
  });
}

export async function renameDocument(id, fileName) {
  return requestJson(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { fileName }
  });
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

export function sendChatMessageStream({ conversationId, message, signal, onMeta, onSources, onToken, onDone, onError }) {
  return new Promise((resolve, reject) => {
    let cancelled = false;

    if (signal) {
      if (signal.aborted) {
        cancelled = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }

      const onAbort = () => {
        cancelled = true;
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
    }

    fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversationId || undefined,
        message
      }),
      signal,
      credentials: 'include'
    }).then(async (response) => {
      if (!response.ok) {
        let errorMessage = 'Stream request failed.';

        try {
          const errorBody = await response.json();
          errorMessage = errorBody?.message ?? errorMessage;
        } catch {
          // ignore parse error
        }

        throw new Error(errorMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (cancelled) {
          reader.cancel().catch(() => {});
          return;
        }

        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;

            let event;

            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            switch (event.type) {
              case 'meta':
                onMeta?.(event);
                break;
              case 'sources':
                onSources?.(event);
                break;
              case 'token':
                onToken?.(event);
                break;
              case 'done':
                onDone?.(event);
                resolve();
                return;
              case 'error':
                onError?.(event);
                reject(new Error(event.message || 'Stream error'));
                return;
              case 'ping':
                break;
              default:
                break;
            }
          }
        }
      }

      reject(new Error('Stream ended without done event.'));
    }).catch((error) => {
      if (cancelled) return;
      onError?.({ message: error.message });
      reject(error);
    });
  });
}

export async function listConversations() {
  return requestJson('/api/chat/conversations');
}

export async function getConversationMessages(conversationId) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export async function renameConversation(id, title) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title }
  });
}

export async function deleteConversation(id) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export async function getConversationDocuments(conversationId) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(conversationId)}/documents`);
}

export async function attachDocumentToConversation(conversationId, documentId) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(conversationId)}/documents`, {
    method: 'POST',
    body: { documentId }
  });
}

export async function detachDocumentFromConversation(conversationId, documentId) {
  return requestJson(`/api/chat/conversations/${encodeURIComponent(conversationId)}/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE'
  });
}