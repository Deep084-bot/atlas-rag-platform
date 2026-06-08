import { useEffect, useState } from 'react';

import { deleteDocument, listDocuments, renameDocument as renameDocumentApi } from '../api/atlasApi.js';

const POLLING_STATUSES = new Set(['uploaded', 'extracting', 'chunking', 'embedding']);

export function useDocuments() {
  const [documents, setDocuments] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

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
    void loadDocuments().catch(() => {});
  }, [refreshNonce]);

  useEffect(() => {
    const shouldPoll = documents.some((document) => POLLING_STATUSES.has(document.status));

    if (!shouldPoll) {
      return undefined;
    }

    const timer = setInterval(() => {
      void loadDocuments().catch(() => {});
    }, 2000);

    return () => clearInterval(timer);
  }, [documents]);

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
