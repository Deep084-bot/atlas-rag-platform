import { useEffect, useRef, useState } from 'react';

import { deleteDocument, listDocuments, renameDocument as renameDocumentApi } from '../api/atlasApi.js';
import { hasProcessingDocuments, nextPollPlan, POLL_DEFAULTS } from './documentPolling.js';

export function useDocuments() {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  const pollIntervalRef = useRef(POLL_DEFAULTS.initialIntervalMs);
  const pollStartRef = useRef(null);
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(false);

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

    pollTimerRef.current = setTimeout(async () => {
      try {
        const nextDocuments = await loadDocuments();
        const plan = nextPollPlan({
          documents: nextDocuments,
          elapsedMs: Date.now() - pollStartRef.current,
          currentIntervalMs: pollIntervalRef.current
        });

        if (plan.stop) {
          pollStartRef.current = null;
          pollIntervalRef.current = POLL_DEFAULTS.initialIntervalMs;
          return;
        }

        pollIntervalRef.current = plan.nextIntervalMs;
        startPoll(plan.delayMs);
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
        pollIntervalRef.current = POLL_DEFAULTS.initialIntervalMs;
        startPoll(POLL_DEFAULTS.initialIntervalMs);
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
