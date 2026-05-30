import { useState } from 'react';

import { generateAnswer } from '../api/atlasApi.js';

export function useGenerate() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function ask() {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError('Enter a question.');
      return null;
    }

    setStatus('loading');
    setError('');

    try {
      const result = await generateAnswer({ question: trimmedQuestion });
      setAnswer(result.answer ?? '');
      setSources(result.sources ?? []);
      setStatus('success');
      return result;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Generation failed.');
      throw error_;
    }
  }

  return {
    question,
    setQuestion,
    answer,
    sources,
    status,
    error,
    ask,
    isLoading: status === 'loading'
  };
}