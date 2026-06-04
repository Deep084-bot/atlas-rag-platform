import multer from 'multer';
import { Router } from 'express';

import { classifyError, ValidationError } from '../errors.js';
import { validateDocumentUpload } from './extractText.js';
import { UploadValidationError } from './errors.js';

function buildUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024
    }
  }).single('file');
}

function stripInternalDocumentFields(document) {
  if (!document) {
    return null;
  }

  const metadata = { ...document };
  delete metadata.storagePath;
  return metadata;
}

function requireAuthenticatedUser(request, response) {
  const userId = request.user?.id;

  if (!userId) {
    response.status(401).json({
      error: 'unauthorized',
      category: 'authentication',
      message: 'Authentication required.'
    });
    return null;
  }

  return userId;
}

export function createDocumentsRouter({ storageProvider, documentsRepository, chunkService, embeddingService, documentOrchestrator }) {
  const router = Router();
  const upload = buildUploadMiddleware();

  router.get('/', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const documents = await documentsRepository.listDocumentsForUser(userId);

      return response.json(documents.map(stripInternalDocumentFields));
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_list_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.get('/:id', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const document = await documentsRepository.getDocumentByIdForUser(request.params.id, userId);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json({
        document: {
          ...stripInternalDocumentFields(document),
          extractedText: document.extractedText
        }
      });
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_read_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.post('/upload', (request, response) => {
    upload(request, response, async (error) => {
      if (error) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return response.status(400).json({
            error: 'upload_validation_failed',
            category: 'validation',
            message: 'File too large'
          });
        }

        const message = error instanceof Error ? error.message : 'Failed to process upload.';
        return response.status(400).json({
          error: 'upload_validation_failed',
          category: 'validation',
          message
        });
      }

      if (!request.file) {
        return response.status(400).json({
          error: 'file_required',
          category: 'validation',
          message: 'File is required.'
        });
      }

      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      let savedFile = null;

      try {
        const documentType = validateDocumentUpload({
          mimeType: request.file.mimetype,
          originalName: request.file.originalname
        });

        savedFile = await storageProvider.saveFile({
          buffer: request.file.buffer,
          originalName: request.file.originalname,
          mimeType: request.file.mimetype
        });

        const persistedDocument = await documentsRepository.insertDocument({
          id: savedFile.documentId,
          userId,
          fileName: request.file.originalname,
          fileType: documentType.fileType,
          fileSizeBytes: request.file.size,
          storagePath: savedFile.storagePath,
          extractedText: '',
          sourceType: 'upload',
          status: 'uploaded',
          progress: 10
        });

        void documentOrchestrator.startDocumentIngestion(persistedDocument.id);

        return response.status(201).json({
          document: stripInternalDocumentFields(persistedDocument)
        });
      } catch (error_) {
        if (savedFile?.storagePath) {
          try {
            await storageProvider.deleteFile(savedFile.storagePath);
          } catch {
            // Best-effort cleanup.
          }
        }

        if (error_ instanceof UploadValidationError || error_ instanceof ValidationError) {
          return response.status(400).json({
            error: 'upload_validation_failed',
            category: 'validation',
            message: error_.message
          });
        }

        const classified = classifyError(error_);

        return response.status(classified.statusCode).json({
          error: 'document_upload_failed',
          category: classified.category,
          message: classified.message
        });
      }
    });
  });

  router.delete('/:id', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const deletedDocument = await documentsRepository.deleteDocumentByIdForUser(request.params.id, userId);

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
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_delete_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.post('/:id/chunk', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const document = await documentsRepository.getDocumentByIdForUser(request.params.id, userId);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      const result = await chunkService.chunkDocument(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_chunk_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.get('/:id/chunks', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const document = await documentsRepository.getDocumentByIdForUser(request.params.id, userId);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      const result = await chunkService.listDocumentChunks(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_chunks_read_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.post('/:id/embed', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const document = await documentsRepository.getDocumentByIdForUser(request.params.id, userId);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      const result = await embeddingService.embedDocument(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_embed_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.get('/:id/embeddings/status', async (request, response) => {
    try {
      const result = await embeddingService.getEmbeddingStatus(request.params.id);

      if (!result) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      return response.json(result);
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_embedding_status_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  router.get('/:id/status', async (request, response) => {
    try {
      const userId = requireAuthenticatedUser(request, response);

      if (!userId) {
        return;
      }

      const document = await documentsRepository.getDocumentByIdForUser(request.params.id, userId);

      if (!document) {
        return response.status(404).json({
          error: 'document_not_found'
        });
      }

      const publicDocument = stripInternalDocumentFields(document);

      return response.json({
        document: {
          id: publicDocument.id,
          status: publicDocument.status,
          progress: publicDocument.progress,
          failureReason: publicDocument.failureReason,
          processingStartedAt: publicDocument.processingStartedAt,
          readyAt: publicDocument.readyAt,
          failedAt: publicDocument.failedAt
        }
      });
    } catch (error) {
      const classified = classifyError(error);
      return response.status(classified.statusCode).json({
        error: 'document_status_failed',
        category: classified.category,
        message: classified.message
      });
    }
  });

  return router;
}
