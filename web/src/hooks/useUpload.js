import { useState } from 'react';

import { uploadDocument } from '../api/atlasApi.js';

export function useUpload() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [uploadedDocument, setUploadedDocument] = useState(null);

  async function upload() {
    if (!file) {
      setError('Select a file first.');
      return null;
    }

    setStatus('loading');
    setError('');

    try {
      const result = await uploadDocument({ file });
      setUploadedDocument(result.document ?? null);
      setStatus('success');
      return result;
    } catch (error_) {
      setStatus('error');
      setError(error_ instanceof Error ? error_.message : 'Upload failed.');
      throw error_;
    }
  }

  function reset() {
    setFile(null);
    setStatus('idle');
    setError('');
  }

  return {
    file,
    setFile,
    status,
    error,
    setError,
    uploadedDocument,
    upload,
    reset,
    isLoading: status === 'loading'
  };
}