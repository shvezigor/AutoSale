import { describe, expect, it } from 'vitest';

import { calculateOrderPaymentSummary } from './order-payments.js';

describe('calculateOrderPaymentSummary', () => {
  it.each([
    [[], 'UNPAID', '0.00', '500.00'],
    [[{ amount: '200.00', cancelledAt: null }], 'PARTIALLY_PAID', '200.00', '300.00'],
    [[{ amount: '500.00', cancelledAt: null }], 'PAID', '500.00', '0.00'],
    [[{ amount: '550.00', cancelledAt: null }], 'OVERPAID', '550.00', '-50.00'],
    [[{ amount: '500.00', cancelledAt: new Date('2026-09-20T12:00:00Z') }], 'UNPAID', '0.00', '500.00'],
  ] as const)('derives the balance for %#', (payments, status, paidAmount, remainingAmount) => {
    expect(calculateOrderPaymentSummary('500.00', payments)).toEqual({
      status,
      expectedAmount: '500.00',
      paidAmount,
      remainingAmount,
    });
  });

  it('adds decimal values without floating point drift', () => {
    expect(calculateOrderPaymentSummary('0.30', [
      { amount: '0.10', cancelledAt: null },
      { amount: '0.20', cancelledAt: null },
    ])).toMatchObject({ status: 'PAID', paidAmount: '0.30', remainingAmount: '0.00' });
  });

  it('rejects non-canonical money', () => {
    expect(() => calculateOrderPaymentSummary('5', [])).toThrow();
    expect(() => calculateOrderPaymentSummary('5.000', [])).toThrow();
  });
});
