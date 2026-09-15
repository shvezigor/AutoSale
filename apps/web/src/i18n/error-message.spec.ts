import { describe, expect, it } from 'vitest';

import { localizeApiError } from './error-message';
import { createTranslator } from './translator';

describe('localizeApiError', () => {
  it.each([
    ['PROFILE_CURRENT_PASSWORD_INVALID', 'Поточний пароль неправильний', 'The current password is incorrect'],
    ['PROFILE_AVATAR_INVALID', 'Не вдалося обробити зображення профілю', 'Could not process the profile image'],
    ['AUTHENTICATION_REQUIRED', 'Потрібно увійти в систему', 'Please sign in'],
    ['RATE_LIMIT', 'Забагато запитів', 'Too many requests'],
    ['CATALOGUE_IMPORT_FAILED', 'Не вдалося імпортувати каталог', 'Could not import the catalogue'],
    ['CONNECTION_REQUIRED', 'Підключіть службу доставки', 'Connect a delivery service'],
    ['TELEGRAM_CONNECTION_UNAVAILABLE', 'Telegram тимчасово недоступний', 'Telegram is temporarily unavailable'],
    ['GOOGLE_CONNECTION_REQUIRED', 'Підключіть Google', 'Connect Google'],
    ['INSTAGRAM_RATE_LIMITED', 'Instagram тимчасово обмежив надсилання', 'Instagram temporarily limited sending'],
  ])('maps %s in both locales', (code, uk, en) => {
    expect(localizeApiError({ response: { data: { message: code } } }, createTranslator('uk'))).toBe(uk);
    expect(localizeApiError({ code }, createTranslator('en'))).toBe(en);
  });

  it('never exposes unknown server text or stack details', () => {
    const error = { response: { data: { message: 'database password leaked' } }, stack: 'secret stack' };
    expect(localizeApiError(error, createTranslator('en'))).toBe('Something went wrong. Please try again.');
    expect(localizeApiError(error, createTranslator('en'))).not.toContain('secret');
  });
});
