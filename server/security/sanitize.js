const MAX_PUBLIC_DETAIL_LENGTH = 300;
const MAX_SERVER_DETAIL_LENGTH = 1000;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
const DATABASE_URL = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT = /\b(authorization|api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9_]{2,})\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/g;
const FILESYSTEM_PATH = /(?:[A-Za-z]:\\[^\s"'():;]+|~\/[^\s"'():;]+|\/(?:Users|home|app|var|tmp|private|opt|srv|mnt|Volumes|root|workspace|data|usr|etc|Library)\/[^\s"'():;]+)/g;

export function normalizeDiagnosticText(value) {
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function redactSecrets(value) {
  return normalizeDiagnosticText(value)
    .replace(DATABASE_URL, 'postgres://<redacted>')
    .replace(BEARER_TOKEN, 'Bearer <redacted>')
    .replace(SECRET_ASSIGNMENT, '$1=<redacted>')
    .replace(ENV_ASSIGNMENT, '$1=<redacted>');
}

export function redactFilesystemPaths(value) {
  return normalizeDiagnosticText(value).replace(FILESYSTEM_PATH, '<path>');
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function sanitizePublicErrorDetail(value, { maxLength = MAX_PUBLIC_DETAIL_LENGTH } = {}) {
  return truncate(redactFilesystemPaths(redactSecrets(value)), maxLength);
}

export function sanitizeServerLogDetail(value, { maxLength = MAX_SERVER_DETAIL_LENGTH } = {}) {
  return truncate(redactSecrets(value), maxLength);
}
