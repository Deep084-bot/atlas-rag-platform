import Tesseract from 'tesseract.js';
import { ProviderError } from '../errors.js';

export async function ocrPageImages(pageImages, { signal } = {}) {
  console.log('[OCR] creating Tesseract worker');
  const worker = await Tesseract.createWorker('eng');
  console.log('[OCR] Tesseract worker created');
  const results = [];

  try {
    for (let i = 0; i < pageImages.length; i++) {
      if (signal?.aborted) {
        throw new DOMException('OCR cancelled.', 'AbortError');
      }

      console.log('[OCR] OCR page %d/%d started (image=%d bytes)', i + 1, pageImages.length, pageImages[i].length);
      try {
        const { data } = await worker.recognize(pageImages[i], { signal });
        const chars = (data.text || '').length;
        console.log('[OCR] OCR page %d/%d completed chars=%d', i + 1, pageImages.length, chars);
        results.push(data.text || '');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.log('[OCR] OCR page %d/%d failed: %s', i + 1, pageImages.length, err instanceof Error ? err.message : String(err));
        results.push('');
      }
    }
  } finally {
    console.log('[OCR] terminating Tesseract worker');
    await worker.terminate();
    console.log('[OCR] Tesseract worker terminated');
  }

  return results;
}
