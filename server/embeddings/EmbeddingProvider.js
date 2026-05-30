export class EmbeddingProvider {
  async embed() {
    throw new Error('EmbeddingProvider.embed must be implemented by a subclass.');
  }

  async embedMany() {
    throw new Error('EmbeddingProvider.embedMany must be implemented by a subclass.');
  }
}
