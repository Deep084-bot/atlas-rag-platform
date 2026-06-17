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
  const doc = await pdfjsLib.getDocument({ data: pdfBuffer, canvasFactory, useSystemFonts: true }).promise;

  const pageCount = Math.min(doc.numPages, maxPages);
  const pageImages = [];

  try {
    for (let i = 1; i <= pageCount; i++) {
      if (signal?.aborted) {
        throw new DOMException('OCR cancelled.', 'AbortError');
      }

      const page = await doc.getPage(i);
      try {
        const rawViewport = page.getViewport({ scale: 1 });
        const scale = clampScale(rawViewport);
        const viewport = page.getViewport({ scale });
        const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;

        const pngBuffer = canvas.toBuffer('image/png');
        pageImages.push(pngBuffer);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  if (pageImages.length === 0) {
    throw new ProviderError('No pages could be rendered from this PDF.', { provider: 'Renderer' });
  }

  return pageImages;
}
