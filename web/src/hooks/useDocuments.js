import { useEffect, useRef, useState } from 'react';

import { deleteDocument, listDocuments, renameDocument as renameDocumentApi } from '../api/atlasApi.js';

const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'ocr', 'chunking', 'embedding']);
const POLLING_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_INITIAL_MS = 2_000;
const POLL_INTERVAL_MAX_MS = 10_000;
const POLL_BACKOFF_RATE = 1.5;

export function useDocuments() {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const pollIntervalRef = useRef(POLL_INTERVAL_INITIAL_MS);
  const pollStartRef = useRef(null);
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(false);

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
      try {
        const nextDocuments = await loadDocuments();
        if (!hasProcessingDocuments(nextDocuments)) {
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

  async function loadDocuments() {
    setStatus((currentStatus) => (currentStatus === 'idle' ? 'loading' : currentStatus));
    setError('');

    try {
      const result = await listDocuments();
      const nextDocuments = Array.isArray(result) ? result : result.documents ?? [];
      setDocuments(nextDocuments);
      setStatus('success');
      return nextDocuments;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Failed to load documents.');
      throw error_;
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    void loadDocuments().then((docs) => {
      if (mountedRef.current && hasProcessingDocuments(docs)) {
        pollIntervalRef.current = POLL_INTERVAL_INITIAL_MS;
        startPoll(POLL_INTERVAL_INITIAL_MS);
      }
    }).catch(() => {});

    return () => {
      mountedRef.current = false;
      cancelPollTimer();
    };
  }, [refreshNonce]);

  async function removeDocument(documentId) {
    const previous = documents;
    setDocuments((current) => current.filter((d) => d.id !== documentId));

    try {
      await deleteDocument(documentId);
    } catch (err) {
      setDocuments(previous);
      throw err;
    }
  }

  async function renameDocument(documentId, fileName) {
    const previous = documents;
    setDocuments((current) =>
      current.map((d) => (d.id === documentId ? { ...d, fileName } : d))
    );

    try {
      await renameDocumentApi(documentId, fileName);
    } catch (err) {
      setDocuments(previous);
      throw err;
    }
  }

  return {
    documents,
    setDocuments,
    status,
    error,
    reload: loadDocuments,
    refresh: () => {
      setRefreshNonce((value) => value + 1);
    },
    isLoading: status === 'loading',
    removeDocument,
    renameDocument
  };
}
