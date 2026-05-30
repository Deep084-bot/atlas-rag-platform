export class StorageProvider {
  async saveFile() {
    throw new Error('StorageProvider.saveFile must be implemented by a subclass.');
  }

  async ensureReady() {
    throw new Error('StorageProvider.ensureReady must be implemented by a subclass.');
  }

  async deleteFile() {
    throw new Error('StorageProvider.deleteFile must be implemented by a subclass.');
  }
}
