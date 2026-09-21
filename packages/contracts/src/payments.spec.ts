import { describe, expect, it } from 'vitest';

import { cancelOrderPaymentSchema, createOrderPaymentSchema } from './payments.js';

describe('payment contracts', () => {
  it('normalizes a valid bank transfer command', () => {
    expect(createOrderPaymentSchema.parse({
      amount: '1200.00',
      method: 'BANK_TRANSFER',
      receivedAt: '2026-09-20T12:00:00.000Z',
      bankAccountId: '11111111-1111-4111-8111-111111111111',
      carrier: null,
      note: ' Передоплата ',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      amount: '1200.00',
      method: 'BANK_TRANSFER',
      receivedAt: '2026-09-20T12:00:00.000Z',
      bankAccountId: '11111111-1111-4111-8111-111111111111',
      carrier: null,
      note: 'Передоплата',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('accepts every supported method with its required reference', () => {
    const base = { amount: '10.00', receivedAt: '2026-09-20T12:00:00.000Z' };
    expect(createOrderPaymentSchema.parse({ ...base, method: 'CASH', idempotencyKey: '33333333-3333-4333-8333-333333333333' }).method).toBe('CASH');
    expect(createOrderPaymentSchema.parse({ ...base, method: 'OTHER', idempotencyKey: '44444444-4444-4444-8444-444444444444' }).method).toBe('OTHER');
    expect(createOrderPaymentSchema.parse({ ...base, method: 'CASH_ON_DELIVERY', carrier: 'NOVA_POSHTA', idempotencyKey: '55555555-5555-4555-8555-555555555555' }).method).toBe('CASH_ON_DELIVERY');
  });

  it('rejects zero money and missing method-specific data', () => {
    expect(() => createOrderPaymentSchema.parse({ amount: '0.00', method: 'CASH', receivedAt: '2026-09-20T12:00:00.000Z', idempotencyKey: '66666666-6666-4666-8666-666666666666' })).toThrow();
    expect(() => createOrderPaymentSchema.parse({ amount: '10.00', method: 'BANK_TRANSFER', receivedAt: '2026-09-20T12:00:00.000Z', idempotencyKey: '77777777-7777-4777-8777-777777777777' })).toThrow();
    expect(() => createOrderPaymentSchema.parse({ amount: '10.00', method: 'CASH_ON_DELIVERY', receivedAt: '2026-09-20T12:00:00.000Z', idempotencyKey: '88888888-8888-4888-8888-888888888888' })).toThrow();
  });

  it('requires a meaningful cancellation reason', () => {
    expect(() => cancelOrderPaymentSchema.parse({ reason: ' ', idempotencyKey: '99999999-9999-4999-8999-999999999999' })).toThrow();
    expect(cancelOrderPaymentSchema.parse({ reason: ' Помилкова сума ', idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).toEqual({
      reason: 'Помилкова сума',
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
