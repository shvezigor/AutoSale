import { describe, expect, it } from 'vitest';

import {
  procurementSummaryFor,
  procurementTransitionSchema,
  telegramNotificationPreferencesSchema,
} from './procurement.js';

describe('procurement contracts', () => {
  it('accepts only statuses that a manager may set directly', () => {
    expect(procurementTransitionSchema.parse({ status: 'TO_ORDER' })).toEqual({ status: 'TO_ORDER' });
    expect(() => procurementTransitionSchema.parse({ status: 'SENDING' })).toThrow();
  });

  it.each([
    { statuses: ['IN_STOCK', 'RECEIVED'] as const, handedOff: false, expected: 'READY' },
    { statuses: ['IN_STOCK', 'TO_ORDER'] as const, handedOff: false, expected: 'PARTIALLY_READY' },
    { statuses: ['TO_ORDER'] as const, handedOff: false, expected: 'NEEDS_ORDER' },
    { statuses: ['ORDERED', 'SUPPLIER_CONFIRMED'] as const, handedOff: false, expected: 'AWAITING_SUPPLIER' },
    { statuses: ['IN_STOCK'] as const, handedOff: true, expected: 'HANDED_OFF' },
  ])('derives $expected deterministically', ({ statuses, handedOff, expected }) => {
    expect(procurementSummaryFor([...statuses], handedOff)).toBe(expected);
  });

  it('accepts the complete personal Telegram preference set', () => {
    expect(telegramNotificationPreferencesSchema.parse({
      ORDER_NEEDS_REVIEW: true,
      ORDER_AUTO_APPROVED: false,
      SUPPLIER_DELIVERY_FAILED: true,
    })).toBeTruthy();
  });

  it('rejects partial or unknown Telegram preference keys', () => {
    expect(() => telegramNotificationPreferencesSchema.parse({ ORDER_NEEDS_REVIEW: true })).toThrow();
    expect(() => telegramNotificationPreferencesSchema.parse({
      ORDER_NEEDS_REVIEW: true,
      ORDER_AUTO_APPROVED: true,
      SUPPLIER_DELIVERY_FAILED: true,
      UNKNOWN_EVENT: true,
    })).toThrow();
  });
});
