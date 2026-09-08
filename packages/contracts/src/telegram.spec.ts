import { describe, expect, it } from 'vitest';

import {
  telegramConnectionSummarySchema,
  telegramDeliveryJobSchema,
  telegramLinkPurposeSchema,
  telegramLinkResponseSchema,
} from './telegram.js';

describe('Telegram contracts', () => {
  it.each(['PERSONAL', 'SUPPLIER_GROUP'])('accepts the supported %s link purpose', (purpose) => {
    expect(telegramLinkPurposeSchema.parse(purpose)).toBe(purpose);
  });

  it('accepts a strict safe connection summary', () => {
    const summary = {
      available: true,
      botUsername: 'AutoSaleBot',
      personal: {
        connected: true,
        displayName: 'Ігор',
        username: 'shvezigor',
        linkedAt: '2026-09-08T12:00:00.000Z',
      },
    };

    expect(telegramConnectionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects secrets and external identifiers from the public summary', () => {
    expect(() => telegramConnectionSummarySchema.parse({
      available: true,
      botUsername: 'AutoSaleBot',
      personal: { connected: false, displayName: null, username: null, linkedAt: null },
      botToken: 'must-not-leak',
      telegramUserId: '123456789',
    })).toThrow();
  });

  it('accepts the one-time link response without exposing the raw token separately', () => {
    const response = {
      url: 'https://t.me/AutoSaleBot?start=opaque_one_time_value',
      expiresAt: '2026-09-08T12:05:00.000Z',
    };

    expect(telegramLinkResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts only a delivery UUID in the queue contract', () => {
    expect(telegramDeliveryJobSchema.parse({
      deliveryId: '11111111-1111-4111-8111-111111111111',
    })).toEqual({ deliveryId: '11111111-1111-4111-8111-111111111111' });
    expect(() => telegramDeliveryJobSchema.parse({ deliveryId: 'bad', text: 'PII must not enter Redis' })).toThrow();
  });
});
