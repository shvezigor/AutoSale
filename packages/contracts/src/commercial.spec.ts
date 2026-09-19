import { describe, expect, it } from 'vitest';

import { bankAccountInputSchema, commercialTermsUpdateSchema, moneyStringSchema } from './commercial.js';

describe('commercial contracts', () => {
  it('accepts versioned account selection', () => {
    expect(commercialTermsUpdateSchema.safeParse({
      version: 2,
      legalEntityId: '11111111-1111-4111-8111-111111111111',
      bankAccountId: '22222222-2222-4222-8222-222222222222',
    }).success).toBe(true);
  });

  it('rejects invalid IBAN and currency input', () => {
    expect(bankAccountInputSchema.safeParse({
      legalEntityId: '11111111-1111-4111-8111-111111111111',
      label: 'Основний UAH',
      iban: 'not-an-iban',
      currency: 'UAH',
      active: true,
      isDefault: true,
    }).success).toBe(false);
    expect(bankAccountInputSchema.safeParse({
      legalEntityId: '11111111-1111-4111-8111-111111111111',
      label: 'Основний',
      iban: 'UA000000000000000000000000000',
      currency: 'hryvnia',
      active: true,
      isDefault: true,
    }).success).toBe(false);
  });

  it('accepts normalized two-decimal money only', () => {
    expect(moneyStringSchema.safeParse('4395.00').success).toBe(true);
    expect(moneyStringSchema.safeParse('4395').success).toBe(false);
    expect(moneyStringSchema.safeParse(4395).success).toBe(false);
  });
});
