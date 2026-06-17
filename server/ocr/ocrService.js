import { renderPdfPages } from './pdfRenderer.js';
import { ocrPageImages } from './ocrText.js';
import { ProviderError } from '../errors.js';

const MAX_QUEUE_DEPTH = 5;
const QUEUE_ACQUIRE_TIMEOUT_MS = 300_000;

let lockAcquired = false;
let queue = [];

function acquire(timeoutMs = QUEUE_ACQUIRE_TIMEOUT_MS) {
  if (!lockAcquired && queue.length === 0) {
    lockAcquired = true;
    return Promise.resolve();
  }

  if (queue.length >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new ProviderError(
      'OCR server is busy. Please try again later.',
      { provider: 'OCR', statusCode: 503 }
    ));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = queue.indexOf(entry);
      if (idx !== -1) queue.splice(idx, 1);
      reject(new ProviderError(
        'OCR request timed out waiting in queue.',
        { provider: 'OCR', statusCode: 504 }
      ));
    }, timeoutMs);

    const entry = () => { clearTimeout(timer); resolve(); };
    queue.push(entry);
  });
}

function release() {
  if (queue.length > 0) {
    const next = queue.shift();
    next();
  } else {
    lockAcquired = false;
  }
}

export async function ocrPdf(pdfBuffer, { maxPages = 10, signal } = {}) {
  console.log('[OCR] acquire lock');
  await acquire();
  console.log('[OCR] lock acquired');
  try {
    console.log('[OCR] rendering pages');
    const pageImages = await renderPdfPages(pdfBuffer, { maxPages, signal });
    console.log('[OCR] rendered pages count=%d', pageImages.length);

    console.log('[OCR] starting OCR images count=%d', pageImages.length);
    const texts = await ocrPageImages(pageImages, { signal });
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    console.log('[OCR] OCR finished totalChars=%d', totalChars);

    return texts.join('\n').trim();
  } finally {
    release();
  }
}
