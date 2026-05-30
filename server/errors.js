export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ProviderError extends Error {
  constructor(message, { provider = 'provider', statusCode = 502, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.retryable = retryable;

    if (cause) {
      this.cause = cause;
    }
  }
}

export class DatabaseError extends Error {
  constructor(message, { cause = null } = {}) {
    super(message);
    this.name = 'DatabaseError';

    if (cause) {
      this.cause = cause;
    }
  }
}

export function isDatabaseError(error) {
  return Boolean(error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code));
}

export function classifyError(error) {
  if (error instanceof ValidationError) {
    return {
      category: 'validation',
      statusCode: 400,
      message: error.message
    };
  }

  if (error instanceof ProviderError) {
    return {
      category: 'provider',
      statusCode: error.statusCode ?? 502,
      message: error.message
    };
  }

  if (error instanceof DatabaseError || isDatabaseError(error)) {
    return {
      category: 'database',
      statusCode: 503,
      message: 'Database operation failed.'
    };
  }

  return {
    category: 'internal',
    statusCode: 500,
    message: 'Internal server error.'
  };
}