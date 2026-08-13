import { GenerationProvider } from './GenerationProvider.js';
import { ProviderError } from '../errors.js';
import { fetchWithRetry } from '../http/fetchWithRetry.js';
import { randomUUID } from 'node:crypto';

export class GroqProvider extends GenerationProvider {
  constructor({ apiKey, model, baseUrl = 'https://api.groq.com/openai/v1' } = {}) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async generate({ messages, temperature = 0, maxTokens = 512 } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError('GroqProvider.generate expects a non-empty messages array.');
    }

    if (typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new ProviderError('GROQ_API_KEY is not configured.', {
        provider: 'Groq',
        statusCode: 500
      });
    }

    if (typeof this.model !== 'string' || this.model.trim() === '') {
      throw new ProviderError('GROQ_MODEL is not configured.', {
        provider: 'Groq',
        statusCode: 500
      });
    }

    const response = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        include_reasoning: false,
        stream: false
      })
    }, {
      providerName: 'Groq',
      timeoutMs: 15000,
      retries: 2
    });

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      throw new ProviderError('Groq returned an invalid JSON response.', {
        provider: 'Groq',
        statusCode: 502,
        cause: error
      });
    }
    const answerText = payload?.choices?.[0]?.message?.content ?? '';

    if (typeof answerText !== 'string' || answerText.trim() === '') {
      throw new ProviderError('Groq returned an empty answer.', {
        provider: 'Groq',
        statusCode: 502
      });
    }

    return {
      provider: 'groq',
      model: this.model,
      answerText: answerText.trim(),
      usage: payload?.usage ?? null,
      finishReason: payload?.choices?.[0]?.finish_reason ?? null,
      rawResponse: payload
    };
  }

  async *generateStream({ messages, temperature = 0, maxTokens = 512, signal } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError('GroqProvider.generateStream expects a non-empty messages array.');
    }

    if (typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
      throw new ProviderError('GROQ_API_KEY is not configured.', {
        provider: 'Groq',
        statusCode: 500
      });
    }

    if (typeof this.model !== 'string' || this.model.trim() === '') {
      throw new ProviderError('GROQ_MODEL is not configured.', {
        provider: 'Groq',
        statusCode: 500
      });
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        include_reasoning: false,
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      let errorBody = '';

      try {
        errorBody = await response.text();
      } catch {
        errorBody = response.statusText;
      }

      throw new ProviderError(`Groq streaming request failed (${response.status}): ${errorBody}`, {
        provider: 'Groq',
        statusCode: 502,
        retryable: response.status >= 500
      });
    }

    if (!response.body) {
      throw new ProviderError('Groq returned an empty response body for streaming.', {
        provider: 'Groq',
        statusCode: 502
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const rawChunk = decoder.decode(value, { stream: true });

        buffer += rawChunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed?.choices?.[0]?.delta?.content || '';

            if (content) {
              yield content;
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}