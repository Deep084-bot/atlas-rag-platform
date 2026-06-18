import { DatabaseError } from '../errors.js';

export class DocumentsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  toDocumentSummary(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSizeBytes: Number(row.file_size_bytes),
      storagePath: row.storage_path,
      sourceType: row.source_type,
      status: row.status,
      progress: Number(row.progress ?? 0),
      ocrQuality: row.ocr_quality ?? null,
      processingStartedAt: row.processing_started_at,
      readyAt: row.ready_at,
      failedAt: row.failed_at,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  toDocumentDetails(row) {
    const summary = this.toDocumentSummary(row);

    if (!summary) {
      return null;
    }

    return {
      ...summary,
      extractedText: row.extracted_text ?? ''
    };
  }

  async insertDocument(document) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const query = `
      INSERT INTO documents (
        id,
        user_id,
        file_name,
        file_type,
        file_size_bytes,
        storage_path,
        extracted_text,
        source_type,
        status,
        progress,
        failure_reason,
        processing_started_at,
        ready_at,
        failed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
    `;

    const values = [
      document.id,
      document.userId,
      document.fileName,
      document.fileType,
      document.fileSizeBytes,
      document.storagePath,
      document.extractedText,
      document.sourceType,
      document.status ?? 'uploaded',
      document.progress ?? 0,
      document.failureReason ?? null,
      document.processingStartedAt ?? null,
      document.readyAt ?? null,
      document.failedAt ?? null
    ];

    const result = await this.pool.query(query, values);
    return this.toDocumentSummary(result.rows[0]);
  }

  async updateDocumentText(id, { extractedText, fileType }) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        UPDATE documents
        SET extracted_text = $2,
            file_type = COALESCE($3, file_type),
            updated_at = now()
        WHERE id = $1
        RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      `,
      [id, extractedText, fileType ?? null]
    );

    return this.toDocumentSummary(result.rows[0] ?? null);
  }

  async updateStatus(id, { status, progress, failureReason = null, processingStartedAt = null, readyAt = null, failedAt = null }) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        UPDATE documents
        SET status = $2,
            progress = COALESCE($3, progress),
            failure_reason = $4,
            processing_started_at = COALESCE($5, processing_started_at),
            ready_at = $6,
            failed_at = $7,
            updated_at = now()
        WHERE id = $1
        RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      `,
      [id, status, progress ?? null, failureReason, processingStartedAt, readyAt, failedAt]
    );

    return this.toDocumentSummary(result.rows[0] ?? null);
  }

  async markReady(id, { progress = 100 } = {}) {
    return this.updateStatus(id, {
      status: 'ready',
      progress,
      failureReason: null,
      readyAt: new Date().toISOString()
    });
  }

  async markFailed(id, { failureReason, progress = null } = {}) {
    return this.updateStatus(id, {
      status: 'failed',
      progress,
      failureReason,
      failedAt: new Date().toISOString()
    });
  }

  async listDocuments() {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const query = `
      SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      FROM documents
      ORDER BY created_at DESC, id DESC
    `;

    const result = await this.pool.query(query);
    return result.rows.map((row) => this.toDocumentSummary(row));
  }

  async listDocumentsForUser(userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
        FROM documents
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    );

    return result.rows.map((row) => this.toDocumentSummary(row));
  }

  async getDocumentById(id) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const query = `
      SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, extracted_text, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      FROM documents
      WHERE id = $1
      LIMIT 1
    `;

    const result = await this.pool.query(query, [id]);
    return this.toDocumentDetails(result.rows[0] ?? null);
  }

  async getDocumentByIdForUser(id, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, extracted_text, status, progress, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
        FROM documents
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [id, userId]
    );

    return this.toDocumentDetails(result.rows[0] ?? null);
  }

  async deleteDocumentById(id) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const query = `
      DELETE FROM documents
      WHERE id = $1
      RETURNING id, storage_path
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] ?? null;
  }

  async deleteDocumentByIdForUser(id, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        DELETE FROM documents
        WHERE id = $1
          AND user_id = $2
        RETURNING id, storage_path
      `,
      [id, userId]
    );

    return result.rows[0] ?? null;
  }

  async countConversationsForDocument(documentId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM conversation_documents
        WHERE document_id = $1
      `,
      [documentId]
    );

    return result.rows[0].count;
  }

  async renameDocument(id, userId, fileName) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        UPDATE documents
        SET file_name = $3,
            updated_at = now()
        WHERE id = $1
          AND user_id = $2
        RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, ocr_quality, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      `,
      [id, userId, fileName]
    );

    return this.toDocumentSummary(result.rows[0] ?? null);
  }

  async updateOcrQuality(id, quality) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        UPDATE documents
        SET ocr_quality = $2,
            updated_at = now()
        WHERE id = $1
        RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, status, progress, ocr_quality, failure_reason, processing_started_at, ready_at, failed_at, created_at, updated_at
      `,
      [id, quality]
    );

    return this.toDocumentSummary(result.rows[0] ?? null);
  }
}
