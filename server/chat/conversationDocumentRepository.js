import { DatabaseError } from '../errors.js';

export class ConversationDocumentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  toDocumentSummary(row) {
    return {
      id: row.id,
      fileName: row.file_name,
      fileType: row.file_type,
      status: row.status,
      progress: Number(row.progress ?? 0),
      createdAt: row.created_at,
      readyAt: row.ready_at,
      failureReason: row.failure_reason
    };
  }

  async listByConversation(conversationId, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT d.id, d.file_name, d.file_type, d.status, d.progress, d.created_at, d.ready_at, d.failure_reason
        FROM conversation_documents cd
        INNER JOIN documents d ON d.id = cd.document_id
        INNER JOIN chat_threads ct ON ct.id = cd.conversation_id
        WHERE cd.conversation_id = $1
          AND ct.user_id = $2
        ORDER BY cd.created_at ASC
      `,
      [conversationId, userId]
    );

    return result.rows.map((row) => this.toDocumentSummary(row));
  }

  async attachDocument(conversationId, documentId, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        INSERT INTO conversation_documents (conversation_id, document_id)
        SELECT $1, $2
        WHERE
          EXISTS (SELECT 1 FROM chat_threads WHERE id = $1 AND user_id = $3)
          AND EXISTS (SELECT 1 FROM documents WHERE id = $2 AND user_id = $3)
        ON CONFLICT (conversation_id, document_id) DO NOTHING
        RETURNING conversation_id, document_id, created_at
      `,
      [conversationId, documentId, userId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return {
      conversationId: result.rows[0].conversation_id,
      documentId: result.rows[0].document_id,
      createdAt: result.rows[0].created_at
    };
  }

  async detachDocument(conversationId, documentId, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        DELETE FROM conversation_documents
        WHERE conversation_id = $1
          AND document_id = $2
          AND conversation_id IN (
            SELECT id FROM chat_threads WHERE id = $1 AND user_id = $3
          )
        RETURNING conversation_id, document_id
      `,
      [conversationId, documentId, userId]
    );

    return result.rowCount > 0;
  }

  async countByConversation(conversationId, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM conversation_documents cd
        INNER JOIN chat_threads ct ON ct.id = cd.conversation_id
        WHERE cd.conversation_id = $1
          AND ct.user_id = $2
      `,
      [conversationId, userId]
    );

    return result.rows[0].count;
  }
}
