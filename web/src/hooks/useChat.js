import { useEffect, useState } from 'react';

import { sendChatMessage } from '../api/atlasApi.js';

const CONVERSATION_KEY = 'atlas.chat.conversationId';
const MESSAGE_KEY_PREFIX = 'atlas.chat.messages.';

function loadStoredMessages(conversationId) {
  if (!conversationId) {
    return [];
  }

  try {
    const raw = localStorage.getItem(`${MESSAGE_KEY_PREFIX}${conversationId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistMessages(conversationId, messages) {
  if (!conversationId) {
    return;
  }

  localStorage.setItem(`${MESSAGE_KEY_PREFIX}${conversationId}`, JSON.stringify(messages));
}

function loadConversationId() {
  try {
    return localStorage.getItem(CONVERSATION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function useChat() {
  const [conversationId, setConversationId] = useState(loadConversationId);
  const [messages, setMessages] = useState(() => loadStoredMessages(loadConversationId()));
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!conversationId) {
      try {
        localStorage.removeItem(CONVERSATION_KEY);
      } catch {
        // ignore storage failures
      }
      setMessages([]);
      return;
    }

    try {
      localStorage.setItem(CONVERSATION_KEY, conversationId);

      if (messages.length === 0) {
        setMessages(loadStoredMessages(conversationId));
      }
    } catch {
      // ignore storage failures
    }
  }, [conversationId, messages.length]);

  useEffect(() => {
    persistMessages(conversationId, messages);
  }, [conversationId, messages]);

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
      content: trimmedMessage
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setMessage('');

    try {
      const result = await sendChatMessage({ conversationId, message: trimmedMessage });
      const nextConversationId = result.conversationId ?? conversationId;

      if (nextConversationId && nextConversationId !== conversationId) {
        setConversationId(nextConversationId);
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer ?? '',
        sources: result.sources ?? []
      };

      setMessages((currentMessages) => [...currentMessages, assistantMessage]);
      setStatus('success');
      return result;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Chat failed.');
      throw error_;
    }
  }

  function resetConversation() {
    if (conversationId) {
      try {
        localStorage.removeItem(`${MESSAGE_KEY_PREFIX}${conversationId}`);
      } catch {
        // ignore storage failures
      }
    }

    setConversationId('');
    setMessages([]);
    setMessage('');
    setStatus('idle');
    setError('');
  }

  return {
    conversationId,
    setConversationId,
    messages,
    message,
    setMessage,
    status,
    error,
    send,
    resetConversation,
    isLoading: status === 'loading'
  };
}