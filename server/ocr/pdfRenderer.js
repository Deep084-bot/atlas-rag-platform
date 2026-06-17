import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { ProviderError } from '../errors.js';

const MAX_RENDER_DIM = 2560;

class NapiCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(ctx, width, height) {
    ctx.canvas.width = width;
    ctx.canvas.height = height;
  }
  destroy(ctx) {
    ctx.canvas.width = 0;
    ctx.canvas.height = 0;
  }
}

function clampScale(rawViewport) {
  const dim = Math.max(rawViewport.width, rawViewport.height);
  if (dim <= 0) return 1.5;
  return Math.min(1.5, MAX_RENDER_DIM / dim);
}

export async function renderPdfPages(pdfBuffer, { maxPages = 10, signal } = {}) {
  const canvasFactory = new NapiCanvasFactory();
  console.log('[OCR] buffer type', {
    isBuffer: Buffer.isBuffer(pdfBuffer),
    isUint8Array: pdfBuffer instanceof Uint8Array,
    constructor: pdfBuffer.constructor?.name
  });

  const data = Buffer.isBuffer(pdfBuffer)
    ? new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength)
    : pdfBuffer;

  console.log('[OCR] pdfjs data type', {
    isBuffer: Buffer.isBuffer(data),
    isUint8Array: data instanceof Uint8Array,
    constructor: data.constructor?.name
  });
  console.log('[OCR] loading PDF document');

  let loadingTask;
  let doc;

  try {
    loadingTask = pdfjsLib.getDocument({ data, canvasFactory, useSystemFonts: true });
    doc = await loadingTask.promise;
    console.log('[OCR] PDF loaded pages=%d', doc.numPages);
  } catch (error) {
    console.error('[OCR] getDocument failed', {
      message: error?.message,
      stack: error?.stack
    });
    throw error;
  }

  console.log('[OCR] doc methods', {
    destroy: typeof doc.destroy,
    cleanup: typeof doc.cleanup,
    numPages: doc.numPages
  });

  const pageCount = Math.min(doc.numPages, maxPages);
  const pageImages = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      if (signal?.aborted) {
        throw new DOMException('OCR cancelled.', 'AbortError');
      }

      console.log('[OCR] rendering page %d/%d', i, pageCount);
      const page = await doc.getPage(i);
      try {
        const rawViewport = page.getViewport({ scale: 1 });
        const scale = clampScale(rawViewport);
        const viewport = page.getViewport({ scale });

        console.log('[OCR] page %d viewport=%dx%d scale=%f', i, Math.round(viewport.width), Math.round(viewport.height), scale);
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;

        const pngBuffer = canvas.toBuffer('image/png');
        console.log('[OCR] page %d rendered size=%d bytes', i, pngBuffer.length);
        pageImages.push(pngBuffer);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    try {
      if (typeof doc?.cleanup === 'function') {
        await doc.cleanup();
      }
    } catch (error) {
      console.warn('[OCR] doc.cleanup failed', error);
    }

    try {
      loadingTask?.destroy();
    } catch (error) {
      console.warn('[OCR] loadingTask.destroy failed', error);
    }
  }

  if (pageImages.length === 0) {
    throw new ProviderError('No pages could be rendered from this PDF.', { provider: 'Renderer' });
  }

  console.log('[OCR] render complete totalPages=%d', pageImages.length);
  return pageImages;
}
