import { EmbeddingProvider } from './EmbeddingProvider.js';
import { ProviderError } from '../errors.js';
import { fetchWithRetry } from '../http/fetchWithRetry.js';

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';
const DEFAULT_BASE_URL = 'https://router.huggingface.co/hf-inference/models';
const DEFAULT_DIMENSIONS = 384;

function isNumberVector(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isTokenMatrix(value) {
    return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]) && isNumberVector(value[0]);
}

function isBatchMatrix(value) {
    return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]) && Array.isArray(value[0][0]);
}

function averageVectors(vectors) {
    const dimensions = vectors[0].length;
    const totals = Array.from({ length: dimensions }, () => 0);

    for (const vector of vectors) {
        for (let index = 0; index < dimensions; index += 1) {
            totals[index] += Number(vector[index] ?? 0);
        }
    }

    return totals.map((value) => value / vectors.length);
}

function normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));

    if (magnitude === 0 || !Number.isFinite(magnitude) || magnitude < 1e-10) {
        throw new ProviderError('Hugging Face returned invalid embedding values.', {
            provider: 'Hugging Face',
            statusCode: 502
        });
    }

    return vector.map((value) => value / magnitude);
}

function normalizeEmbeddingOutput(output, textsCount = 1) {
    if (!Array.isArray(output) || output.length === 0) {
        throw new ProviderError('Hugging Face returned an empty embedding.', {
            provider: 'Hugging Face',
            statusCode: 502
        });
    }

    if (isNumberVector(output)) {
        return [normalizeVector(output.map((value) => Number(value)))];
    }

    if (isBatchMatrix(output)) {
        return output.map((item) => normalizeEmbeddingOutput(item, 1)[0]);
    }

    if (isTokenMatrix(output)) {
        if (textsCount > 1 && output.length === textsCount) {
            return output.map((vector) => normalizeVector(vector.map((value) => Number(value))));
        }

        return [normalizeVector(averageVectors(output))];
    }

    throw new ProviderError('Unexpected embedding response format from Hugging Face.', {
        provider: 'Hugging Face',
        statusCode: 502
    });
}

export class HuggingFaceProvider extends EmbeddingProvider {
    constructor({ apiKey, model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL, dimensions = DEFAULT_DIMENSIONS } = {}) {
        super();
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
        this.dimensions = dimensions;
    }

    async embed(text) {
        const embeddings = await this.embedMany([text]);
        if (!embeddings || embeddings.length === 0) {
            throw new ProviderError('Hugging Face returned empty embedding.', {
                provider: 'Hugging Face',
                statusCode: 502
            });
        }
        return embeddings[0];
    }

    async embedMany(texts) {
        if (!Array.isArray(texts)) {
            throw new TypeError('embedMany expects an array of strings.');
        }

        if (texts.length === 0) {
            return [];
        }

        const modelPath = this.model.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const url = `${this.baseUrl}/${modelPath}/pipeline/feature-extraction`;

        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey ?? ''}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: texts.length === 1 ? texts[0] : texts,
                options: {
                    wait_for_model: true
                }
            })
        }, {
            providerName: 'Hugging Face',
            timeoutMs: 15000,
            retries: 2
        });

        if (!response.ok) {
            let errorText = '';

            try {
                errorText = await response.text();
            } catch {
                errorText = response.statusText ?? '';
            }

            const detail = errorText ? `: ${errorText.slice(0, 300)}` : '';

            throw new ProviderError(`Hugging Face request failed with status ${response.status}${detail}`, {
                provider: 'Hugging Face',
                statusCode: 502,
                retryable: response.status >= 500
            });
        }

        let payload;

        try {
            payload = await response.json();
        } catch (error) {
            throw new ProviderError('Hugging Face returned an invalid JSON response.', {
                provider: 'Hugging Face',
                statusCode: 502,
                cause: error
            });
        }
        const normalized = normalizeEmbeddingOutput(payload, texts.length);

        if (!Array.isArray(normalized) || normalized.length !== texts.length) {
            throw new ProviderError('Hugging Face returned an unexpected number of embeddings.', {
                provider: 'Hugging Face',
                statusCode: 502
            });
        }

        for (const vec of normalized) {
            if (!Array.isArray(vec) || vec.length === 0) {
                throw new ProviderError('Hugging Face returned an empty embedding.', {
                    provider: 'Hugging Face',
                    statusCode: 502
                });
            }

            if (!vec.every((item) => Number.isFinite(item))) {
                throw new ProviderError('Hugging Face returned invalid embedding values.', {
                    provider: 'Hugging Face',
                    statusCode: 502
                });
            }

            if (Number.isFinite(this.dimensions) && this.dimensions > 0 && vec.length !== this.dimensions) {
                throw new ProviderError('Hugging Face returned embedding with unexpected dimensions.', {
                    provider: 'Hugging Face',
                    statusCode: 502
                });
            }
        }

        return normalized;
    }
}
