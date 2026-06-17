import Tesseract from 'tesseract.js';
import { ProviderError } from '../errors.js';

export async function ocrPageImages(pageImages, { signal } = {}) {
  const worker = await Tesseract.createWorker('eng');
  const results = [];

  try {
    for (const image of pageImages) {
      if (signal?.aborted) {
        throw new DOMException('OCR cancelled.', 'AbortError');
      }

      try {
        const { data } = await worker.recognize(image, { signal });
        results.push(data.text || '');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        results.push('');
      }
    }
  } finally {
    await worker.terminate();
  }

  return results;
}
