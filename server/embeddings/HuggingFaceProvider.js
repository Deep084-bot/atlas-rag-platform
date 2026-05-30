import { EmbeddingProvider } from './EmbeddingProvider.js';

const DEFAULT_MODEL = 'BAAI/bge-small-en-v1.5';
const DEFAULT_BASE_URL = 'https://router.huggingface.co/hf-inference/models';

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

    if (magnitude === 0) {
        return vector;
    }

    return vector.map((value) => value / magnitude);
}

function normalizeEmbeddingOutput(output) {
    if (!Array.isArray(output) || output.length === 0) {
        return [];
    }

    if (isBatchMatrix(output)) {
        return output.map((item) => normalizeEmbeddingOutput(item));
    }

    if (isTokenMatrix(output)) {
        return normalizeVector(averageVectors(output));
    }

    if (isNumberVector(output)) {
        return normalizeVector(output.map((value) => Number(value)));
    }

    throw new Error('Unexpected embedding response format from Hugging Face.');
}

export class HuggingFaceProvider extends EmbeddingProvider {
    constructor({ apiKey, model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL } = {}) {
        super();
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
    }

    async embed(text) {
        const embeddings = await this.embedMany([text]);
        return embeddings[0] ?? [];
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

        console.log("HF URL:", url);

        let response;

        try {
            response = await fetch(url, {
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
            });

            console.log("HF Status:", response.status);
        } catch (err) {
            console.error("HF FETCH ERROR:", err);
            throw err;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Hugging Face embedding request failed with status ${response.status}: ${errorText}`);
        }

        const payload = await response.json();
        const normalized = normalizeEmbeddingOutput(payload);

        if (texts.length === 1 && Array.isArray(normalized) && normalized.length > 0 && typeof normalized[0] === 'number') {
            return [normalized];
        }

        return normalized;
    }
}
