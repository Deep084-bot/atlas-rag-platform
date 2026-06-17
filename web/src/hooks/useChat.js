import { useEffect, useState, useCallback, useRef } from 'react';

import { listConversations, getConversationMessages, renameConversation as renameConversationApi, deleteConversation as deleteConversationApi, sendChatMessageStream, getConversationDocuments, attachDocumentToConversation, detachDocumentFromConversation } from '../api/atlasApi.js';

function normalizeMessage(msg) {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    sources: msg.citations ?? msg.sources ?? [],
    createdAt: msg.createdAt,
    conversationId: msg.conversationId ?? msg.threadId,
  };
}

export function useChat() {
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [conversationDocuments, setConversationDocuments] = useState([]);
  const [conversationDocumentsLoading, setConversationDocumentsLoading] = useState(false);
  const [conversationDocumentsError, setConversationDocumentsError] = useState('');

  const activeRequestRef = useRef('');
  const abortControllerRef = useRef(null);
  const streamIdRef = useRef(0);
  const lastAssistantIdRef = useRef(null);

  const fetchConversations = useCallback(async (background = false) => {
    if (!background) {
      setConversationsLoading(true);
    }
    setConversationsError('');
    try {
      const data = await listConversations();
      setConversations(data);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      if (!background) {
        setConversationsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const fetchConversationDocuments = useCallback(async (conversationId) => {
    if (!conversationId) return;

    setConversationDocumentsLoading(true);
    setConversationDocumentsError('');

    try {
      const docs = await getConversationDocuments(conversationId);
      if (activeRequestRef.current !== conversationId) return;
      setConversationDocuments(Array.isArray(docs) ? docs : []);
    } catch (err) {
      if (activeRequestRef.current !== conversationId) return;
      setConversationDocumentsError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      if (activeRequestRef.current === conversationId) {
        setConversationDocumentsLoading(false);
      }
    }
  }, []);

  const selectConversation = useCallback(async (id) => {
    setActiveConversationId(id);
    setMessages([]);
    setConversationDocuments([]);
    setMessagesLoading(true);
    setConversationDocumentsLoading(true);
    setMessagesError('');
    setConversationDocumentsError('');
    activeRequestRef.current = id;

    try {
      const [data, docs] = await Promise.all([
        getConversationMessages(id),
        getConversationDocuments(id)
      ]);
      if (activeRequestRef.current !== id) return;
      setMessages(data.map(normalizeMessage));
      setConversationDocuments(Array.isArray(docs) ? docs : []);
    } catch (err) {
      if (activeRequestRef.current !== id) return;
      const message = err instanceof Error ? err.message : 'Failed to load conversation';
      setMessagesError(message);
      setConversationDocumentsError(message);
    } finally {
      if (activeRequestRef.current === id) {
        setMessagesLoading(false);
        setConversationDocumentsLoading(false);
      }
    }
  }, []);

  async function attachDocument(conversationId, documentId) {
    try {
      await attachDocumentToConversation(conversationId, documentId);
      await fetchConversationDocuments(conversationId);
    } catch {
      throw new Error('Failed to attach document.');
    }
  }

  async function detachDocument(conversationId, documentId) {
    try {
      await detachDocumentFromConversation(conversationId, documentId);
      await fetchConversationDocuments(conversationId);
    } catch {
      throw new Error('Failed to detach document.');
    }
  }

  async function send() {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError('Enter a message.');
      return null;
    }

    const streamId = ++streamIdRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;

      const orphanId = lastAssistantIdRef.current;
      if (orphanId) {
        setMessages((current) => current.filter((msg) => msg.id !== orphanId));
      }
      lastAssistantIdRef.current = null;
    }

    setStatus('loading');
    setError('');

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedMessage,
    };

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      sources: [],
    };

    lastAssistantIdRef.current = assistantMessage.id;

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setMessage('');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let newConversationId = null;

    try {
      await sendChatMessageStream({
        conversationId: activeConversationId || undefined,
        message: trimmedMessage,
        signal: abortController.signal,
        onMeta: (event) => {
          if (streamIdRef.current !== streamId) return;
          if (event.conversationId && event.conversationId !== activeConversationId) {
            newConversationId = event.conversationId;
          }
        },
        onSources: (event) => {
          if (streamIdRef.current !== streamId) return;
          const sources = event.sources ?? [];
          setMessages((current) =>
            current.map((msg) =>
              msg.id === assistantMessage.id ? { ...msg, sources } : msg
            )
          );
        },
        onToken: (event) => {
          if (streamIdRef.current !== streamId) return;
          setStatus('streaming');
          setMessages((current) =>
            current.map((msg) =>
              msg.id === assistantMessage.id
                ? { ...msg, content: msg.content + event.text }
                : msg
            )
          );
        },
        onDone: () => {
          if (streamIdRef.current !== streamId) return;
        },
      });

      if (streamIdRef.current !== streamId) return;

      abortControllerRef.current = null;
      lastAssistantIdRef.current = null;
      setStatus('success');

      if (newConversationId) {
        setActiveConversationId(newConversationId);
        await fetchConversations(true);
      }
    } catch (error_) {
      if (streamIdRef.current !== streamId) return;

      abortControllerRef.current = null;
      lastAssistantIdRef.current = null;

      if (error_.name === 'AbortError') {
        setStatus('aborted');
        return;
      }

      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Chat failed.');
      throw error_;
    }
  }

  function abortStream() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;

      const orphanId = lastAssistantIdRef.current;
      if (orphanId) {
        setMessages((current) => current.filter((msg) => msg.id !== orphanId));
      }
      lastAssistantIdRef.current = null;
      streamIdRef.current++;
      setStatus('aborted');
    }
  }

  function resetConversation() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    lastAssistantIdRef.current = null;
    streamIdRef.current++;
    setActiveConversationId('');
    setMessages([]);
    setConversationDocuments([]);
    setMessage('');
    setStatus('idle');
    setError('');
  }

  async function renameConversation(id, title) {
    const previous = conversations;

    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );

    try {
      await renameConversationApi(id, title);
    } catch {
      setConversations(previous);
    }
  }

  async function deleteConversation(id) {
    const wasActive = id === activeConversationId;
    const previous = conversations;
    const previousDocs = conversationDocuments;

    setConversations((prev) => prev.filter((c) => c.id !== id));

    if (wasActive) {
      setActiveConversationId('');
      setMessages([]);
      setConversationDocuments([]);
    }

    try {
      await deleteConversationApi(id);
    } catch {
      setConversations(previous);

      if (wasActive) {
        setActiveConversationId(id);
        setConversationDocuments(previousDocs);
      }
    }
  }

  return {
    conversations,
    conversationsLoading,
    conversationsError,
    activeConversationId,
    messages,
    messagesLoading,
    messagesError,
    message,
    setMessage,
    status,
    error,
    send,
    abortStream,
    resetConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    fetchConversations,
    conversationDocuments,
    conversationDocumentsLoading,
    conversationDocumentsError,
    fetchConversationDocuments,
    attachDocument,
    detachDocument,
    isLoading: status === 'loading' || status === 'streaming',
  };
}
