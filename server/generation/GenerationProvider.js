export class GenerationProvider {
  async generate() {
    throw new Error('GenerationProvider.generate must be implemented by a subclass.');
  }

  generateStream() {
    throw new Error('GenerationProvider.generateStream must be implemented by a subclass.');
  }
}