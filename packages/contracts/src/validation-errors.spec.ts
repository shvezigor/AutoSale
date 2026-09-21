import { describe, expect, it } from 'vitest';

import { validationFailureSchema } from './validation-errors.js';

describe('validationFailureSchema', () => {
  it('accepts a bounded machine-readable validation response', () => {
    const payload = {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [
        { field: 'iban', code: 'INVALID_IBAN' },
        { field: 'items.item-1.quantity', code: 'INVALID_QUANTITY' },
      ],
    };

    expect(validationFailureSchema.parse(payload)).toEqual(payload);
  });

  it.each([
    { name: 'unsafe field path', issue: { field: 'iban secret', code: 'INVALID_IBAN' } },
    { name: 'empty code', issue: { field: 'iban', code: '' } },
    { name: 'submitted value', issue: { field: 'iban', code: 'INVALID_IBAN', value: 'UA000000000000000000000000000' } },
  ])('rejects an issue with $name', ({ issue }) => {
    expect(validationFailureSchema.safeParse({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [issue],
    }).success).toBe(false);
  });

  it('rejects more than 32 issues', () => {
    expect(validationFailureSchema.safeParse({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: Array.from({ length: 33 }, (_, index) => ({ field: `field-${index}`, code: 'INVALID_INPUT' })),
    }).success).toBe(false);
  });
});
