import { useEffect, useState, useCallback, useRef } from 'react';

import { sendChatMessage, listConversations, getConversationMessages, renameConversation as renameConversationApi, deleteConversation as deleteConversationApi } from '../api/atlasApi.js';

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

  const activeRequestRef = useRef('');

  const fetchConversations = useCallback(async () => {
    setConversationsLoading(true);
    setConversationsError('');
    try {
      const data = await listConversations();
      setConversations(data);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : 'Failed to load conversations');
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const selectConversation = useCallback(async (id) => {
    setActiveConversationId(id);
    setMessages([]);
    setMessagesLoading(true);
    setMessagesError('');
    activeRequestRef.current = id;

    try {
      const data = await getConversationMessages(id);
      if (activeRequestRef.current !== id) return;
      setMessages(data.map(normalizeMessage));
    } catch (err) {
      if (activeRequestRef.current !== id) return;
      setMessagesError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      if (activeRequestRef.current === id) {
        setMessagesLoading(false);
      }
    }
  }, []);

  async function send() {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError('Enter a message.');
      return null;
    }

    setStatus('loading');
    setError('');

    const userMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedMessage,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setMessage('');

    try {
      const result = await sendChatMessage({
        conversationId: activeConversationId || undefined,
        message: trimmedMessage,
      });

      const nextConversationId = result.conversationId ?? activeConversationId;
      const isNewConversation = nextConversationId && nextConversationId !== activeConversationId;

      if (isNewConversation) {
        setActiveConversationId(nextConversationId);
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer ?? '',
        sources: result.sources ?? [],
      };

      setMessages((currentMessages) => [...currentMessages, assistantMessage]);
      setStatus('success');

      if (isNewConversation) {
        await fetchConversations();
      }

      return result;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Chat failed.');
      throw error_;
    }
  }

  function resetConversation() {
    setActiveConversationId('');
    setMessages([]);
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

    setConversations((prev) => prev.filter((c) => c.id !== id));

    if (wasActive) {
      setActiveConversationId('');
      setMessages([]);
    }

    try {
      await deleteConversationApi(id);
    } catch {
      setConversations(previous);

      if (wasActive) {
        setActiveConversationId(id);
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
    resetConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    fetchConversations,
    isLoading: status === 'loading',
  };
}
