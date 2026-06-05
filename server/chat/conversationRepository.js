import { randomUUID } from 'node:crypto';

import { DatabaseError } from '../errors.js';

export class ConversationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  toConversation(row) {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  toConversationMessage(row) {
    return {
      id: row.id,
      conversationId: row.thread_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    };
  }

  async createConversation({ userId = null, title = 'Untitled thread' } = {}) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const id = randomUUID();
    const result = await this.pool.query(
      `
        INSERT INTO chat_threads (
          id,
          user_id,
          title
        ) VALUES ($1, $2, $3)
        RETURNING id, user_id, title, created_at, updated_at
      `,
      [id, userId, title]
    );

    return this.toConversation(result.rows[0]);
  }

  async getConversationById(id) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, user_id, title, created_at, updated_at
        FROM chat_threads
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );

    return this.toConversation(result.rows[0] ?? null);
  }

  async getConversationByIdForUser(id, userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, user_id, title, created_at, updated_at
        FROM chat_threads
        WHERE id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [id, userId]
    );

    return this.toConversation(result.rows[0] ?? null);
  }

  async listRecentMessages(conversationId, limit = 6) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, thread_id, role, content, created_at
        FROM chat_messages
        WHERE thread_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [conversationId, limit]
    );

    return result.rows.reverse().map((row) => this.toConversationMessage(row));
  }

  async listRecentMessagesForUser(conversationId, userId, limit = 6) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT messages.id, messages.thread_id, messages.role, messages.content, messages.created_at
        FROM chat_messages AS messages
        INNER JOIN chat_threads AS threads ON threads.id = messages.thread_id
        WHERE messages.thread_id = $1
          AND threads.user_id = $2
        ORDER BY messages.created_at DESC, messages.id DESC
        LIMIT $3
      `,
      [conversationId, userId, limit]
    );

    return result.rows.reverse().map((row) => this.toConversationMessage(row));
  }

  async listConversationsForUser(userId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, user_id, title, created_at, updated_at
        FROM chat_threads
        WHERE user_id = $1
        ORDER BY updated_at DESC
      `,
      [userId]
    );

    return result.rows.map((row) => this.toConversation(row));
  }

  async getMessagesByConversationId(conversationId) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const result = await this.pool.query(
      `
        SELECT id, thread_id, role, content, citations, created_at
        FROM chat_messages
        WHERE thread_id = $1
        ORDER BY created_at ASC
      `,
      [conversationId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      conversationId: row.thread_id,
      role: row.role,
      content: row.content,
      citations: row.citations,
      createdAt: row.created_at
    }));
  }

  async appendConversationTurn({ conversationId, userMessage, assistantMessage, assistantSources = [] }) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const conversationUpdate = await client.query(
        `
          UPDATE chat_threads
          SET updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `,
        [conversationId]
      );

      if (conversationUpdate.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
          INSERT INTO chat_messages (
            thread_id,
            role,
            content,
            citations
          ) VALUES ($1, 'user', $2, '[]'::jsonb)
        `,
        [conversationId, userMessage]
      );

      await client.query(
        `
          INSERT INTO chat_messages (
            thread_id,
            role,
            content,
            citations
          ) VALUES ($1, 'assistant', $2, $3::jsonb)
        `,
        [conversationId, assistantMessage, JSON.stringify(assistantSources)]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendConversationTurnForUser({ conversationId, userId, userMessage, assistantMessage, assistantSources = [] }) {
    if (this.pool === null) {
      throw new DatabaseError('DATABASE_URL is not configured.');
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const conversationUpdate = await client.query(
        `
          UPDATE chat_threads
          SET updated_at = NOW()
          WHERE id = $1
            AND user_id = $2
          RETURNING id
        `,
        [conversationId, userId]
      );

      if (conversationUpdate.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `
          INSERT INTO chat_messages (
            thread_id,
            role,
            content,
            citations
          ) VALUES ($1, 'user', $2, '[]'::jsonb)
        `,
        [conversationId, userMessage]
      );

      await client.query(
        `
          INSERT INTO chat_messages (
            thread_id,
            role,
            content,
            citations
          ) VALUES ($1, 'assistant', $2, $3::jsonb)
        `,
        [conversationId, assistantMessage, JSON.stringify(assistantSources)]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}