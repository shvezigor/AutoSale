import type { MessageKey, Translator } from './translator';

const codeKeys = {
  PROFILE_CURRENT_PASSWORD_INVALID: 'errors.currentPasswordInvalid',
  PROFILE_AVATAR_INVALID: 'errors.avatarInvalid',
  PROFILE_AVATAR_TOO_LARGE: 'errors.avatarInvalid',
  AUTHENTICATION_REQUIRED: 'errors.authenticationRequired',
  UNAUTHORIZED: 'errors.authenticationRequired',
  FORBIDDEN: 'errors.accessDenied',
  INSUFFICIENT_ACCESS: 'errors.accessDenied',
  RATE_LIMIT: 'errors.rateLimit',
  RATE_LIMITED: 'errors.rateLimit',
  CATALOGUE_IMPORT_FAILED: 'errors.catalogueImportFailed',
  INVALID_CATALOGUE_UPLOAD: 'errors.catalogueImportFailed',
  CONNECTION_REQUIRED: 'errors.deliveryConnectionRequired',
  TELEGRAM_CONNECTION_UNAVAILABLE: 'errors.telegramUnavailable',
  GOOGLE_CONNECTION_REQUIRED: 'errors.googleRequired',
  INSTAGRAM_RATE_LIMITED: 'errors.instagramRateLimited',
} satisfies Record<string, MessageKey>;

export function localizeApiError(error: unknown, t: Translator): string {
  const code = readStableCode(error);
  return t(code && code in codeKeys ? codeKeys[code as keyof typeof codeKeys] : 'errors.generic');
}

function readStableCode(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof value === 'string') return /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['code', 'message', 'error', 'data', 'response', 'body']) {
    const code = readStableCode(record[key], depth + 1);
    if (code) return code;
  }
  return null;
}
