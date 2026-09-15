import { describe, expect, it } from 'vitest';

import { enMessages } from './messages/en';
import { ukMessages } from './messages/uk';
import { createTranslator, messageLeafPaths } from './translator';

describe('typed translations', () => {
  it('keeps English and Ukrainian dictionary shapes complete', () => {
    expect(messageLeafPaths(enMessages)).toEqual(messageLeafPaths(ukMessages));
  });

  it('reads typed keys and interpolates values', () => {
    const english = createTranslator('en');
    expect(english('navigation.orders')).toBe('Orders');
    expect(english('common.greeting', { name: 'Ihor' })).toBe('Hello, Ihor');
  });

  it('uses the Ukrainian value as the safe runtime fallback', () => {
    const english = createTranslator('en', { common: { greeting: '' } });
    expect(english('common.greeting', { name: 'Ігор' })).toBe('Вітаємо, Ігор');
  });
});
