import { createTranslator } from '../i18n/translator';
import {
  clearFieldError,
  focusFirstInvalid,
  nativeConstraintMessage,
} from './form-validation';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
});

describe('clearFieldError', () => {
  it('clears only the changed field without mutating the previous object', () => {
    const errors = { email: 'bad', phone: 'bad' };

    expect(clearFieldError(errors, 'email')).toEqual({ phone: 'bad' });
    expect(errors).toEqual({ email: 'bad', phone: 'bad' });
    expect(clearFieldError<'email' | 'phone' | 'name'>(errors, 'name')).toBe(errors);
  });
});

describe('nativeConstraintMessage', () => {
  it('localizes a required-field constraint in Ukrainian', () => {
    const input = document.createElement('input');
    input.required = true;

    expect(nativeConstraintMessage(input, createTranslator('uk'))).toBe('Заповніть це поле.');
  });

  it('localizes an invalid email constraint in English', () => {
    const input = document.createElement('input');
    input.type = 'email';
    input.value = 'not-an-email';

    expect(nativeConstraintMessage(input, createTranslator('en'))).toBe('Enter a valid email address.');
  });

  it('returns null for a valid control', () => {
    const input = document.createElement('input');
    input.required = true;
    input.value = 'ready';

    expect(nativeConstraintMessage(input, createTranslator('uk'))).toBeNull();
  });
});

describe('focusFirstInvalid', () => {
  it('focuses the first enabled invalid field in the supplied order', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="email" aria-invalid="true" />
      <input name="phone" aria-invalid="true" />
    `;
    document.body.append(form);

    focusFirstInvalid(form, ['phone', 'email']);

    expect(document.activeElement).toBe(form.elements.namedItem('phone'));
  });

  it('skips disabled controls and supports data-field paths', () => {
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="phone" aria-invalid="true" disabled />
      <input data-field="items.item-1.quantity" aria-invalid="true" />
    `;
    document.body.append(form);

    focusFirstInvalid(form, ['phone', 'items.item-1.quantity']);

    expect(document.activeElement).toBe(form.querySelector('[data-field="items.item-1.quantity"]'));
  });
});
