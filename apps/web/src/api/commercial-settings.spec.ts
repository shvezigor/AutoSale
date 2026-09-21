import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBankAccount } from './commercial-settings';
import { ValidationApiError } from './validation-errors';

const input = {
  legalEntityId: '22222222-2222-4222-8222-222222222222',
  label: 'Основний',
  iban: 'UA000000000000000000000000000',
  bankName: 'Fictional Bank',
  currency: 'UAH',
  active: true,
  isDefault: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('commercial settings mutations', () => {
  it('throws a typed error only for allowlisted validation issues', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        issues: [{ field: 'iban', code: 'INVALID_IBAN' }],
      }), { status: 400 })));

    const promise = createBankAccount(input);
    await expect(promise).rejects.toBeInstanceOf(ValidationApiError);
    await expect(promise).rejects.toMatchObject({
      failure: { issues: [{ field: 'iban', code: 'INVALID_IBAN' }] },
    });
  });

  it('keeps unknown server failures generic', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'csrf' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ statusCode: 500 }), { status: 500 })));

    await expect(createBankAccount(input)).rejects.toThrow('Commercial settings API returned HTTP 500');
  });
});
