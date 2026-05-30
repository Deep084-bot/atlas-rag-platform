import { GenerationProvider } from './GenerationProvider.js';
import { ProviderError } from '../errors.js';
import { fetchWithRetry } from '../http/fetchWithRetry.js';

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
        max_tokens: maxTokens,
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
}