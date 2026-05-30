import { ProviderError } from '../errors.js';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function buildDelay(attempt, baseDelayMs) {
  return baseDelayMs * (2 ** attempt);
}

export async function fetchWithRetry(url, options, {
  providerName,
  timeoutMs = 15000,
  retries = 2,
  baseDelayMs = 250
} = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (RETRYABLE_STATUSES.has(response.status)) {
        const errorText = await response.text();

        if (attempt < retries) {
          await sleep(buildDelay(attempt, baseDelayMs));
          continue;
        }

        throw new ProviderError(
          `${providerName} request failed with status ${response.status}: ${errorText}`,
          {
            provider: providerName,
            statusCode: response.status,
            retryable: true
          }
        );
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (isAbortError(error)) {
        lastError = new ProviderError(`${providerName} request timed out after ${timeoutMs}ms.`, {
          provider: providerName,
          statusCode: 504,
          retryable: true,
          cause: error
        });
      } else if (error instanceof ProviderError) {
        lastError = error;
      } else {
        lastError = new ProviderError(`${providerName} request failed.`, {
          provider: providerName,
          statusCode: 503,
          retryable: true,
          cause: error
        });
      }

      if (attempt < retries) {
        await sleep(buildDelay(attempt, baseDelayMs));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new ProviderError(`${providerName} request failed.`, {
    provider: providerName,
    statusCode: 503,
    retryable: true
  });
}