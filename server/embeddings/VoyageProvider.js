import { EmbeddingProvider } from './EmbeddingProvider.js';
import { ProviderError } from '../errors.js';
import { fetchWithRetry } from '../http/fetchWithRetry.js';

const DEFAULT_MODEL = 'voyage-4-lite';
const DEFAULT_BASE_URL = 'https://api.voyageai.com/v1';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const MAX_BATCH_SIZE = 1000;

// Voyage 4-series / 3-series models support these output dimensions. Other models
// (e.g. voyage-law-2, voyage-finance-2) only support 1024. 384 is not supported.
export const SUPPORTED_OUTPUT_DIMENSIONS = new Set([256, 512, 1024, 2048]);
const VALID_INPUT_TYPES = new Set(['query', 'document']);

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));

  if (magnitude === 0 || !Number.isFinite(magnitude) || magnitude < 1e-10) {
    throw new ProviderError('Voyage returned invalid embedding values.', {
      provider: 'Voyage',
      statusCode: 502
    });
  }

  return vector.map((value) => value / magnitude);
}

/**
 * Normalize the `usage` object from a Voyage response.
 *
 * Returns `{ available: true, totalTokens, promptTokens }` only when the API
 * reports a finite, non-negative `total_tokens`. Anything missing or malformed is
 * reported as unavailable rather than being coerced into a fake number.
 *
 * @param {unknown} payload
 * @returns {{ available: boolean, totalTokens: number|null, promptTokens: number|null }}
 */
export function normalizeUsage(payload) {
  const usage = payload && typeof payload === 'object' ? payload.usage : null;

  if (!usage || typeof usage !== 'object') {
    return { available: false, totalTokens: null, promptTokens: null };
  }

  const total = usage.total_tokens;
  const prompt = usage.prompt_tokens;

  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
    return { available: false, totalTokens: null, promptTokens: null };
  }

  return {
    available: true,
    totalTokens: total,
    promptTokens: Number.isFinite(prompt) && prompt >= 0 ? prompt : null
  };
}

export class VoyageProvider extends EmbeddingProvider {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    dimensions = null,
    inputType = null,
    normalize = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    maxBatchSize = MAX_BATCH_SIZE,
    onUsage = null
  } = {}) {
    super();

    if (dimensions !== null && dimensions !== undefined && !SUPPORTED_OUTPUT_DIMENSIONS.has(dimensions)) {
      throw new ProviderError(
        `Unsupported Voyage output dimension ${dimensions}. Supported: ${[...SUPPORTED_OUTPUT_DIMENSIONS].join(', ')}.`,
        { provider: 'Voyage', statusCode: 400 }
      );
    }

    if (inputType !== null && inputType !== undefined && !VALID_INPUT_TYPES.has(inputType)) {
      throw new ProviderError(
        `Unsupported Voyage inputType "${inputType}". Use "query" or "document".`,
        { provider: 'Voyage', statusCode: 400 }
      );
    }

    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.dimensions = dimensions;
    this.inputType = inputType;
    this.normalize = normalize;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.maxBatchSize = maxBatchSize;
    this.onUsage = typeof onUsage === 'function' ? onUsage : null;

    this.resetUsage();
  }

  /**
   * Discard accumulated usage counters. Counters only ever reflect successful,
   * fully-validated responses, so retried or failed requests are never counted.
   */
  resetUsage() {
    this._usage = {
      requestCount: 0,
      requestsWithUsage: 0,
      requestsWithoutUsage: 0,
      totalTokens: 0
    };
  }

  /**
   * @returns {{
   *   requestCount: number,
   *   requestsWithUsage: number,
   *   requestsWithoutUsage: number,
   *   totalTokens: number|null,
   *   usageAvailable: boolean|null,
   *   complete: boolean|null
   * }}
   */
  getUsageSnapshot() {
    const { requestCount, requestsWithUsage, requestsWithoutUsage, totalTokens } = this._usage;

    return {
      requestCount,
      requestsWithUsage,
      requestsWithoutUsage,
      totalTokens: requestsWithUsage > 0 ? totalTokens : null,
      usageAvailable: requestCount === 0 ? null : requestsWithUsage > 0,
      complete: requestCount === 0 ? null : requestsWithoutUsage === 0
    };
  }

  _recordUsage(usage) {
    this._usage.requestCount += 1;

    if (usage.available) {
      this._usage.requestsWithUsage += 1;
      this._usage.totalTokens += usage.totalTokens;
    } else {
      this._usage.requestsWithoutUsage += 1;
    }

    if (this.onUsage) {
      this.onUsage({
        available: usage.available,
        totalTokens: usage.available ? usage.totalTokens : null,
        promptTokens: usage.promptTokens ?? null,
        requestCount: this._usage.requestCount
      });
    }
  }

  async embed(text) {
    const { vectors } = await this.requestEmbeddings([text], 'query');

    if (!vectors || vectors.length === 0) {
      throw new ProviderError('Voyage returned an empty embedding.', {
        provider: 'Voyage',
        statusCode: 502
      });
    }

    return vectors[0];
  }

  async embedMany(texts) {
    if (!Array.isArray(texts)) {
      throw new TypeError('embedMany expects an array of strings.');
    }

    if (texts.length === 0) {
      return [];
    }

    if (!texts.every((text) => typeof text === 'string')) {
      throw new TypeError('embedMany expects an array of strings.');
    }

    if (Number.isFinite(this.maxBatchSize) && texts.length > this.maxBatchSize) {
      throw new ProviderError(
        `Voyage batch size ${texts.length} exceeds the maximum of ${this.maxBatchSize}.`,
        { provider: 'Voyage', statusCode: 400 }
      );
    }

    const { vectors } = await this.requestEmbeddings(texts, 'document');

    return vectors;
  }

  /**
   * Like {@link embedMany}, but also returns the usage reported for this request.
   * Keeps the base `embed`/`embedMany` contract (bare vectors) intact.
   *
   * @param {string[]} texts
   * @returns {Promise<{ embeddings: number[][], usage: object|null, usageAvailable: boolean|null }>}
   */
  async embedManyWithUsage(texts) {
    if (!Array.isArray(texts)) {
      throw new TypeError('embedManyWithUsage expects an array of strings.');
    }

    if (texts.length === 0) {
      return { embeddings: [], usage: null, usageAvailable: null };
    }

    if (!texts.every((text) => typeof text === 'string')) {
      throw new TypeError('embedManyWithUsage expects an array of strings.');
    }

    if (Number.isFinite(this.maxBatchSize) && texts.length > this.maxBatchSize) {
      throw new ProviderError(
        `Voyage batch size ${texts.length} exceeds the maximum of ${this.maxBatchSize}.`,
        { provider: 'Voyage', statusCode: 400 }
      );
    }

    const { vectors, usage } = await this.requestEmbeddings(texts, 'document');

    return { embeddings: vectors, usage: usage.available ? usage : null, usageAvailable: usage.available };
  }

  async requestEmbeddings(texts, defaultInputType) {
    const inputType = this.inputType ?? defaultInputType;

    const body = {
      input: texts,
      model: this.model,
      input_type: inputType
    };

    if (Number.isFinite(this.dimensions) && this.dimensions > 0) {
      body.output_dimension = this.dimensions;
    }

    const response = await fetchWithRetry(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey ?? ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, {
      providerName: 'Voyage',
      timeoutMs: this.timeoutMs,
      retries: this.retries
    });

    if (!response.ok) {
      let detail = '';

      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        detail = response.statusText ?? '';
      }

      throw new ProviderError(`Voyage request failed with status ${response.status}.`, {
        provider: 'Voyage',
        statusCode: response.status >= 500 ? 502 : response.status,
        retryable: response.status >= 500,
        cause: detail ? new Error(detail) : null
      });
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      throw new ProviderError('Voyage returned an invalid JSON response.', {
        provider: 'Voyage',
        statusCode: 502,
        cause: error
      });
    }

    const data = payload?.data;

    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new ProviderError('Voyage returned an unexpected number of embeddings.', {
        provider: 'Voyage',
        statusCode: 502
      });
    }

    const ordered = new Array(texts.length);
    data.forEach((item, position) => {
      const index = Number.isInteger(item?.index) ? item.index : position;
      ordered[index] = item;
    });

    const vectors = ordered.map((item) => {
      const vector = item?.embedding;

      if (!Array.isArray(vector) || vector.length === 0) {
        throw new ProviderError('Voyage returned an empty embedding.', {
          provider: 'Voyage',
          statusCode: 502
        });
      }

      if (!vector.every((value) => Number.isFinite(value))) {
        throw new ProviderError('Voyage returned invalid embedding values.', {
          provider: 'Voyage',
          statusCode: 502
        });
      }

      if (Number.isFinite(this.dimensions) && this.dimensions > 0 && vector.length !== this.dimensions) {
        throw new ProviderError('Voyage returned embedding with unexpected dimensions.', {
          provider: 'Voyage',
          statusCode: 502
        });
      }

      const floats = vector.map((value) => Number(value));

      return this.normalize ? normalizeVector(floats) : floats;
    });

    const usage = normalizeUsage(payload);
    this._recordUsage(usage);

    return { vectors, usage };
  }
}
