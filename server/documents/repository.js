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
      createdAt: row.created_at,
      status: 'uploaded'
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
      throw new Error('DATABASE_URL is not configured.');
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
        source_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, file_name, file_type, file_size_bytes, storage_path, source_type, created_at
    `;

    const values = [
      document.id,
      document.userId,
      document.fileName,
      document.fileType,
      document.fileSizeBytes,
      document.storagePath,
      document.extractedText,
      document.sourceType
    ];

    const result = await this.pool.query(query, values);
    return this.toDocumentSummary(result.rows[0]);
  }

  async listDocuments() {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const query = `
      SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, created_at
      FROM documents
      ORDER BY created_at DESC, id DESC
    `;

    const result = await this.pool.query(query);
    return result.rows.map((row) => this.toDocumentSummary(row));
  }

  async getDocumentById(id) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const query = `
      SELECT id, file_name, file_type, file_size_bytes, storage_path, source_type, extracted_text, created_at
      FROM documents
      WHERE id = $1
      LIMIT 1
    `;

    const result = await this.pool.query(query, [id]);
    return this.toDocumentDetails(result.rows[0] ?? null);
  }

  async deleteDocumentById(id) {
    if (this.pool === null) {
      throw new Error('DATABASE_URL is not configured.');
    }

    const query = `
      DELETE FROM documents
      WHERE id = $1
      RETURNING id, storage_path
    `;

    const result = await this.pool.query(query, [id]);
    return result.rows[0] ?? null;
  }
}
