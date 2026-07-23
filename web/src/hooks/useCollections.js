import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'atlas_collections';

function loadCollections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistCollections(collections) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
  } catch {
    /* storage full or unavailable */
  }
}

export function useCollections() {
  const [collections, setCollections] = useState(loadCollections);

  useEffect(() => {
    persistCollections(collections);
  }, [collections]);

  const createCollection = useCallback((name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const collection = {
      id: crypto.randomUUID(),
      name: trimmed,
      documentIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCollections((prev) => [...prev, collection]);
    return collection;
  }, []);

  const renameCollection = useCallback((id, name) => {
    setCollections((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, name: name.trim(), updatedAt: new Date().toISOString() } : c
      )
    );
  }, []);

  const deleteCollection = useCallback((id) => {
    setCollections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addDocumentsToCollection = useCallback((collectionId, documentIds) => {
    setCollections((prev) =>
      prev.map((c) => {
        if (c.id !== collectionId) return c;
        const existing = new Set(c.documentIds);
        for (const docId of documentIds) {
          existing.add(docId);
        }
        return {
          ...c,
          documentIds: [...existing],
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, []);

  const removeDocumentFromCollection = useCallback((collectionId, documentId) => {
    setCollections((prev) =>
      prev.map((c) =>
        c.id === collectionId
          ? {
              ...c,
              documentIds: c.documentIds.filter((id) => id !== documentId),
              updatedAt: new Date().toISOString(),
            }
          : c
      )
    );
  }, []);

  const getCollectionDocuments = useCallback(
    (collectionId, allDocuments) => {
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) return [];
      return collection.documentIds
        .map((docId) => allDocuments.find((d) => d.id === docId))
        .filter(Boolean);
    },
    [collections],
  );

  return {
    collections,
    setCollections,
    createCollection,
    renameCollection,
    deleteCollection,
    addDocumentsToCollection,
    removeDocumentFromCollection,
    getCollectionDocuments,
  };
}
