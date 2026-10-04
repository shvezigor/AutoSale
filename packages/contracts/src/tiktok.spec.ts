import { describe, expect, it } from 'vitest';

import {
  tikTokConnectionSummarySchema,
  tikTokOAuthStartResponseSchema,
} from './tiktok.js';

describe('TikTok Business Messaging contracts', () => {
  it('accepts an active connection with explicit capabilities', () => {
    const parsed = tikTokConnectionSummarySchema.parse({
      status: 'ACTIVE',
      accountId: 'fictional-tiktok-account',
      displayName: 'Fictional Shop',
      capabilities: {
        receiveMessages: true,
        sendText: true,
        sendImage: false,
      },
      tokenExpiresAt: '2026-10-05T09:00:00.000Z',
      lastVerifiedAt: '2026-10-04T09:00:00.000Z',
      lastErrorCode: null,
      cleanupStatus: 'NONE',
    });

    expect(parsed.status).toBe('ACTIVE');
    expect(parsed.capabilities?.receiveMessages).toBe(true);
  });

  it('represents an inbound-only account without implying reply access', () => {
    const parsed = tikTokConnectionSummarySchema.parse({
      status: 'INBOUND_ONLY',
      accountId: 'fictional-tiktok-account',
      displayName: 'Fictional Shop',
      capabilities: {
        receiveMessages: true,
        sendText: false,
        sendImage: false,
      },
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      cleanupStatus: 'NONE',
    });

    expect(parsed.capabilities?.sendText).toBe(false);
  });

  it('rejects unknown capability fields and invalid statuses', () => {
    expect(() => tikTokConnectionSummarySchema.parse({
      status: 'CONNECTED',
      accountId: null,
      displayName: null,
      capabilities: { receiveMessages: true, sendText: false, sendImage: false, sendVideo: true },
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      cleanupStatus: 'NONE',
    })).toThrow();
  });

  it('accepts only an absolute provider authorization URL', () => {
    expect(tikTokOAuthStartResponseSchema.parse({
      authorizationUrl: 'https://business-api.tiktok.com/portal/auth?state=opaque',
    }).authorizationUrl).toContain('state=opaque');
    expect(() => tikTokOAuthStartResponseSchema.parse({ authorizationUrl: '/unsafe-relative' })).toThrow();
  });
});
