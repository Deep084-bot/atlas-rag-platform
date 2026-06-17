import pdfParse from 'pdf-parse';

import { UploadValidationError } from './errors.js';

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').trim();
}

export function validateDocumentUpload({ mimeType, originalName }) {
  const lowerName = (originalName || '').toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return { fileType: 'pdf' };
  }

  if (mimeType === 'text/plain' || lowerName.endsWith('.txt')) {
    return { fileType: 'txt' };
  }

  throw new UploadValidationError('Unsupported file type. Only PDF and TXT files are allowed.');
}

export async function extractTextFromUpload({ buffer, mimeType, originalName }) {
  const { fileType } = validateDocumentUpload({ mimeType, originalName });

  if (fileType === 'pdf') {
    const parsed = await pdfParse(buffer);
    const extractedText = normalizeText(parsed.text);

    return { fileType, extractedText };
  }

  if (fileType === 'txt') {
    const extractedText = normalizeText(buffer.toString('utf8'));

    if (extractedText.length === 0) {
      throw new UploadValidationError(
        'This text file contains no readable content.'
      );
    }

    return { fileType, extractedText };
  }

  throw new UploadValidationError('Unsupported file type. Only PDF and TXT files are allowed.');
}
