import { describe, expect, it } from 'vitest';

import { parseValidationFailure, ValidationApiError } from './validation-errors';

const commercialIssues = {
  iban: ['INVALID_IBAN'],
  currency: ['INVALID_CURRENCY'],
} as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('parseValidationFailure', () => {
  it('returns a bounded validation failure when every issue is allowed', async () => {
    const failure = await parseValidationFailure(jsonResponse(400, {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [
        { field: 'iban', code: 'INVALID_IBAN' },
        { field: 'currency', code: 'INVALID_CURRENCY' },
      ],
    }), commercialIssues);

    expect(failure).toEqual({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      issues: [
        { field: 'iban', code: 'INVALID_IBAN' },
        { field: 'currency', code: 'INVALID_CURRENCY' },
      ],
    });
  });

  it.each([
    ['malformed JSON', new Response('{', { status: 400 }), commercialIssues],
    ['unknown issue code', jsonResponse(400, { statusCode: 400, code: 'VALIDATION_FAILED', issues: [{ field: 'iban', code: 'RAW_PROVIDER_ERROR' }] }), commercialIssues],
    ['unknown field', jsonResponse(400, { statusCode: 400, code: 'VALIDATION_FAILED', issues: [{ field: 'secret', code: 'INVALID_IBAN' }] }), commercialIssues],
    ['conflict', jsonResponse(409, { statusCode: 409, code: 'VALIDATION_FAILED', issues: [{ field: 'iban', code: 'INVALID_IBAN' }] }), commercialIssues],
    ['server error', jsonResponse(500, { statusCode: 500 }), commercialIssues],
  ] as const)('returns null for %s', async (_name, response, allowlist) => {
    await expect(parseValidationFailure(response, allowlist)).resolves.toBeNull();
  });
});

describe('ValidationApiError', () => {
  it('stores safe issues without using them as the Error message', () => {
    const failure = {
      statusCode: 400 as const,
      code: 'VALIDATION_FAILED' as const,
      issues: [{ field: 'iban', code: 'INVALID_IBAN' }],
    };

    const error = new ValidationApiError(failure);

    expect(error.message).toBe('Validation failed');
    expect(error.failure).toEqual(failure);
  });
});
