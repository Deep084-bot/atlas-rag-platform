import { useState } from 'react';

import { searchAtlas } from '../api/atlasApi.js';

export function useSearch() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function search() {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError('Enter a search query.');
      return null;
    }

    setStatus('loading');
    setError('');

    try {
      const result = await searchAtlas({ query: trimmedQuery });
      setMatches(result.matches ?? []);
      setStatus('success');
      return result;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Search failed.');
      throw error_;
    }
  }

  return {
    query,
    setQuery,
    matches,
    status,
    error,
    search,
    isLoading: status === 'loading'
  };
}