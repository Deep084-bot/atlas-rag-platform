import { randomUUID } from 'node:crypto';

import multer from 'multer';
import { Router } from 'express';

import { extractTextFromUpload, validateDocumentUpload } from './extractText.js';
import { UploadValidationError } from './errors.js';

function buildUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024
    }
  }).single('file');
}

export function createDocumentsRouter({ storageProvider, documentsRepository, chunkService }) {
  const router = Router();
  const upload = buildUploadMiddleware();

  router.get('/', async (_request, response) => {
    try {
      const documents = await documentsRepository.listDocuments();

      return response.json({
        documents: documents.map((document) => {
          const metadata = { ...document };
          delete metadata.storagePath;
          return metadata;
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to list documents.';
      return response.status(500).json({
        error: 'document_list_failed',
        message
      });
    }
  });

  router.get('/:id', async (request, response) => {
    try {
      const document = await documentsRepository.getDocumentById(request.params.id);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      const metadata = { ...document };
      delete metadata.storagePath;

      return response.json({
        document: {
          ...metadata,
          extractedText: document.extractedText
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read document.';
      return response.status(500).json({
        error: 'document_read_failed',
        message
      });
    }
  });

  router.post('/upload', (request, response) => {
    upload(request, response, async (error) => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return response.status(400).json({
            error: 'upload_validation_failed',
            message: 'File too large'
          });
        }

        const message = error instanceof Error ? error.message : 'Failed to process upload.';
        return response.status(400).json({ error: 'upload_validation_failed', message });
      }

      if (!request.file) {
        return response.status(400).json({ error: 'file_required' });
      }

      try {
        try {
          validateDocumentUpload({
            mimeType: request.file.mimetype,
            originalName: request.file.originalname
          });
        } catch (validationError) {
          if (validationError instanceof UploadValidationError || validationError instanceof Error) {
            return response.status(400).json({
              error: 'upload_validation_failed',
              message: validationError.message
            });
          }

          throw validationError;
        }

        const savedFile = await storageProvider.saveFile({
          buffer: request.file.buffer,
          originalName: request.file.originalname,
          mimeType: request.file.mimetype
        });

        const extraction = await extractTextFromUpload({
          buffer: request.file.buffer,
          mimeType: request.file.mimetype,
          originalName: request.file.originalname
        });

        const persistedDocument = await documentsRepository.insertDocument({
          id: savedFile.documentId ?? randomUUID(),
          userId: request.body?.userId ?? null,
          fileName: request.file.originalname,
          fileType: extraction.fileType,
          fileSizeBytes: request.file.size,
          storagePath: savedFile.storagePath,
          extractedText: extraction.extractedText,
          sourceType: 'upload'
        });

        return response.status(201).json({
          documentId: persistedDocument.id,
          status: 'uploaded'
        });
      } catch (error_) {
        const message = error_ instanceof Error ? error_.message : 'Unable to upload document.';
        return response.status(500).json({
          error: 'document_upload_failed',
          message
        });
      }
    });
  });

  router.delete('/:id', async (request, response) => {
    try {
      const deletedDocument = await documentsRepository.deleteDocumentById(request.params.id);

      if (!deletedDocument) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      await storageProvider.deleteFile(deletedDocument.storage_path);

      return response.json({
        documentId: request.params.id,
        status: 'deleted'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete document.';
      return response.status(500).json({
        error: 'document_delete_failed',
        message
      });
    }
  });

  router.post('/:id/chunk', async (request, response) => {
    try {
      const result = await chunkService.chunkDocument(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to chunk document.';
      return response.status(500).json({
        error: 'document_chunk_failed',
        message
      });
    }
  });

  router.get('/:id/chunks', async (request, response) => {
    try {
      const result = await chunkService.listDocumentChunks(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read chunks.';
      return response.status(500).json({
        error: 'document_chunks_read_failed',
        message
      });
    }
  });

  return router;
}
