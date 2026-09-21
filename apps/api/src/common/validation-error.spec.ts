import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { validationBadRequest } from './validation-error.js';

describe('validationBadRequest', () => {
  it('maps allowlisted Zod paths to stable safe issue codes', () => {
    const schema = z.object({
      iban: z.string().regex(/^UA\d{27}$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
    });
    const parsed = schema.safeParse({ iban: 'private-bad-value', currency: 'x' });
    if (parsed.success) throw new Error('Expected invalid fixture');

    const response = validationBadRequest(parsed.error, {
      iban: 'INVALID_IBAN',
      currency: 'INVALID_CURRENCY',
    }).getResponse();

    expect(response).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [
        { field: 'iban', code: 'INVALID_IBAN' },
        { field: 'currency', code: 'INVALID_CURRENCY' },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('private-bad-value');
  });

  it('collapses unallowlisted paths to one safe form issue', () => {
    const parsed = z.object({
      customerName: z.string().min(5),
      privateNote: z.string().min(5),
    }).safeParse({ customerName: 'A', privateNote: 'B' });
    if (parsed.success) throw new Error('Expected invalid fixture');

    const response = validationBadRequest(parsed.error, {}).getResponse();

    expect(response).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [{ field: '_form', code: 'INVALID_INPUT' }],
    });
    expect(JSON.stringify(response)).not.toContain('customerName');
    expect(JSON.stringify(response)).not.toContain('privateNote');
  });
});
