const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;

export function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (typeof text !== 'string') {
    throw new TypeError('Text to chunk must be a string.');
  }

  if (text.length === 0) {
    return [];
  }

  if (chunkSize <= 0) {
    throw new RangeError('chunkSize must be greater than zero.');
  }

  if (overlap < 0 || overlap >= chunkSize) {
    throw new RangeError('overlap must be non-negative and smaller than chunkSize.');
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 1;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const content = text.slice(start, end);

    chunks.push({
      chunkIndex,
      content,
      characterCount: content.length
    });

    if (end === text.length) {
      break;
    }

    start = end - overlap;
    chunkIndex += 1;
  }

  return chunks;
}
