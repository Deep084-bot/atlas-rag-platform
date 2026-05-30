import { EmbeddingProvider } from './EmbeddingProvider.js';

export class LocalTransformersProvider extends EmbeddingProvider {
  async embed() {
    throw new Error('LocalTransformersProvider is not implemented yet.');
  }

  async embedMany() {
    throw new Error('LocalTransformersProvider is not implemented yet.');
  }
}
