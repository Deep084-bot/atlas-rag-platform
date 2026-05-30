import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { StorageProvider } from './provider.js';

const uploadsRoot = path.resolve(process.cwd(), 'uploads');

function sanitizeFileName(fileName) {
  return fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export class LocalStorageProvider extends StorageProvider {
  constructor(rootDirectory = uploadsRoot) {
    super();
    this.rootDirectory = rootDirectory;
  }

  async ensureReady() {
    await mkdir(this.rootDirectory, { recursive: true });
  }

  async saveFile({ buffer, originalName, mimeType }) {
    await this.ensureReady();

    const documentId = randomUUID();
    const safeName = sanitizeFileName(originalName || 'upload');
    const storedFileName = `${documentId}-${safeName}`;
    const storagePath = path.join(this.rootDirectory, storedFileName);

    await writeFile(storagePath, buffer);

    return {
      documentId,
      storagePath,
      storedFileName,
      originalName,
      mimeType,
      sizeBytes: buffer.length
    };
  }

  async deleteFile(storagePath) {
    if (!storagePath) {
      return;
    }

    try {
      await unlink(storagePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
