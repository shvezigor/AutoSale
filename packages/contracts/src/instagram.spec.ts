import { describe, expect, it } from 'vitest';

import { instagramConnectionSummarySchema } from './instagram.js';

describe('instagramConnectionSummarySchema', () => {
  it.each([
    'NOT_CONNECTED',
    'LEGACY',
    'ACTIVE',
    'REAUTH_REQUIRED',
    'ERROR',
    'DISCONNECTED',
  ])('accepts the safe %s connection summary', (status) => {
    const summary = {
      status,
      accountId: '17841400000000000',
      username: 'autosale_store',
      tokenExpiresAt: '2026-10-27T12:00:00.000Z',
      lastVerifiedAt: '2026-08-28T12:00:00.000Z',
      lastErrorCode: null,
    };

    expect(instagramConnectionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('accepts nullable account metadata and timestamps', () => {
    const summary = {
      status: 'NOT_CONNECTED',
      accountId: null,
      username: null,
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    };

    expect(instagramConnectionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects credential fields and malformed timestamps', () => {
    expect(() =>
      instagramConnectionSummarySchema.parse({
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: 'tomorrow',
        lastVerifiedAt: null,
        lastErrorCode: null,
        encryptedAccessToken: 'v1.secret',
      }),
    ).toThrow();
  });
});
