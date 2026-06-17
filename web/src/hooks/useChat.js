import { useEffect, useState, useCallback, useRef } from 'react';

import { createConversation as apiCreateConversation, listConversations, getConversationMessages, renameConversation as renameConversationApi, deleteConversation as deleteConversationApi, sendChatMessageStream, getConversationDocuments, attachDocumentToConversation, detachDocumentFromConversation } from '../api/atlasApi.js';

const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'ocr', 'chunking', 'embedding']);
const POLLING_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_INITIAL_MS = 2_000;
const POLL_INTERVAL_MAX_MS = 10_000;
const POLL_BACKOFF_RATE = 1.5;

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
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  const activeRequestRef = useRef('');
  const abortControllerRef = useRef(null);
  const streamIdRef = useRef(0);
  const lastAssistantIdRef = useRef(null);
  const autoInitializedRef = useRef(false);
  const creatingConversationRef = useRef(false);
  const deletingConversationRef = useRef(false);

  const pollTimerRef = useRef(null);
  const pollIntervalRef = useRef(POLL_INTERVAL_INITIAL_MS);
  const pollStartRef = useRef(null);
  const mountedRef = useRef(false);
  const documentsRequestRef = useRef(0);

  function hasProcessingDocuments(docs) {
    return docs.some((d) => POLLING_STATUSES.has(d.status));
  }

  function cancelPollTimer() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function startPoll(delayMs) {
    cancelPollTimer();

    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }

    if (Date.now() - pollStartRef.current >= POLLING_TIMEOUT_MS) {
      pollStartRef.current = null;
      return;
    }

    pollTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;

      const conversationId = activeRequestRef.current;
      if (!conversationId) return;

      try {
        const docs = await getConversationDocuments(conversationId);
        if (activeRequestRef.current !== conversationId) return;
        if (!mountedRef.current) return;
        setConversationDocuments(Array.isArray(docs) ? docs : []);

        if (!hasProcessingDocuments(docs)) {
          pollStartRef.current = null;
          pollIntervalRef.current = POLL_INTERVAL_INITIAL_MS;
          return;
        }

        const nextDelay = Math.min(
          Math.round(pollIntervalRef.current * POLL_BACKOFF_RATE),
          POLL_INTERVAL_MAX_MS
        );
        pollIntervalRef.current = nextDelay;
        startPoll(nextDelay);
      } catch {
        startPoll(pollIntervalRef.current);
      }
    }, delayMs);
  }

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
    mountedRef.current = true;
    fetchConversations();

    return () => {
      mountedRef.current = false;
      cancelPollTimer();
    };
  }, [fetchConversations]);

  useEffect(() => {
    if (autoInitializedRef.current) return;
    if (conversationsLoading) return;

    autoInitializedRef.current = true;

    if (!activeConversationId && !isCreatingConversation) {
      resetConversation();
    }
  }, [conversationsLoading, activeConversationId, isCreatingConversation]);

  const fetchConversationDocuments = useCallback(async (conversationId) => {
    if (!conversationId) return;

    const requestId = ++documentsRequestRef.current;

    console.log('[fetchConversationDocuments] ENTER requestId=%d conversationId=%s activeRequestRef=%s activeConversationId=%s conversationDocuments=%o',
      requestId, conversationId, activeRequestRef.current, activeConversationId, conversationDocuments);

    setConversationDocumentsLoading(true);
    setConversationDocumentsError('');

    try {
      const docs = await getConversationDocuments(conversationId);
      if (requestId !== documentsRequestRef.current) {
        console.log('[fetchConversationDocuments] DISCARDED stale request requestId=%d current=%d',
          requestId, documentsRequestRef.current);
        return;
      }
      console.log('[fetchConversationDocuments] RESOLVED conversationId=%s returned=%d docs=%o',
        conversationId, docs?.length ?? -1, docs);
      setConversationDocuments(Array.isArray(docs) ? docs : []);

      if (hasProcessingDocuments(docs)) {
        pollIntervalRef.current = POLL_INTERVAL_INITIAL_MS;
        startPoll(POLL_INTERVAL_INITIAL_MS);
      }
    } catch (err) {
      if (requestId !== documentsRequestRef.current) return;
      setConversationDocumentsError(err instanceof Error ? err.message : 'Failed to load documents');
    } finally {
      if (requestId === documentsRequestRef.current) {
        setConversationDocumentsLoading(false);
      }
    }
  }, []);

  const selectConversation = useCallback(async (id) => {
    console.log('[selectConversation] ENTER id=%s activeRequestRef was=%s conversationDocuments were=%o',
      id, activeRequestRef.current, conversationDocuments);
    cancelPollTimer();
    setActiveConversationId(id);
    setIsCreatingConversation(false);
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

      if (hasProcessingDocuments(docs)) {
        pollIntervalRef.current = POLL_INTERVAL_INITIAL_MS;
        startPoll(POLL_INTERVAL_INITIAL_MS);
      }
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
        setIsCreatingConversation(false);
        await fetchConversations(true);
      } else if (isCreatingConversation) {
        setIsCreatingConversation(false);
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
    console.log('[resetConversation] activeRequestRef was=%s activeConversationId=%s conversationDocuments=%o',
      activeRequestRef.current, activeConversationId, conversationDocuments);
    cancelPollTimer();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    lastAssistantIdRef.current = null;
    streamIdRef.current++;
    activeRequestRef.current = '';
    setActiveConversationId('');
    setIsCreatingConversation(true);
    setMessages([]);
    setConversationDocuments([]);
    setMessage('');
    setStatus('idle');
    setError('');
  }

  async function createConversation() {
    if (creatingConversationRef.current) return null;
    creatingConversationRef.current = true;

    try {
      const conversation = await apiCreateConversation();
      console.log('[createConversation] id=%s activeRequestRef was=%s now=%s',
        conversation.id, activeRequestRef.current, conversation.id);
      activeRequestRef.current = conversation.id;
      setActiveConversationId(conversation.id);
      setIsCreatingConversation(true);
      setConversationDocuments([]);
      // TODO: remove after confirming no race - fetchConversationDocuments(conversation.id).catch(() => {});
      fetchConversations(true).catch(() => {});
      return conversation;
    } finally {
      creatingConversationRef.current = false;
    }
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
    if (deletingConversationRef.current) return;
    deletingConversationRef.current = true;

    const wasActive = id === activeConversationId;
    const previous = conversations;
    const previousDocs = conversationDocuments;

    setConversations((prev) => prev.filter((c) => c.id !== id));

    if (wasActive) {
      cancelPollTimer();
      activeRequestRef.current = '';
      documentsRequestRef.current++;
      setActiveConversationId('');
      setIsCreatingConversation(false);
      setMessages([]);
      setConversationDocuments([]);
    }

    try {
      await deleteConversationApi(id);
    } catch {
      setConversations(previous);

      if (wasActive) {
        setActiveConversationId(id);
        setIsCreatingConversation(false);
        setConversationDocuments(previousDocs);
      }
    } finally {
      deletingConversationRef.current = false;
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
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    fetchConversations,
    conversationDocuments,
    conversationDocumentsLoading,
    conversationDocumentsError,
    isCreatingConversation,
    fetchConversationDocuments,
    attachDocument,
    detachDocument,
    isLoading: status === 'loading' || status === 'streaming',
  };
}
