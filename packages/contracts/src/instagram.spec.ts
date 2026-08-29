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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
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
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
    };

    expect(instagramConnectionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects malformed timestamps', () => {
    expect(() =>
      instagramConnectionSummarySchema.parse({
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: 'tomorrow',
        lastVerifiedAt: null,
        lastErrorCode: null,
        cleanupStatus: 'NONE',
        cleanupErrorCode: null,
      }),
    ).toThrow();
  });

  it.each(['NONE', 'PENDING', 'FAILED'])('accepts safe cleanup status %s', (cleanupStatus) => {
    const summary = {
      status: 'ACTIVE',
      accountId: '17841400000000000',
      username: 'autosale_store',
      tokenExpiresAt: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
      cleanupStatus,
      cleanupErrorCode: cleanupStatus === 'FAILED' ? 'META_DISCONNECT_CLEANUP_FAILED' : null,
    };

    expect(instagramConnectionSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects credential fields from an otherwise valid summary', () => {
    expect(() =>
      instagramConnectionSummarySchema.parse({
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: '2026-10-27T12:00:00.000Z',
        lastVerifiedAt: '2026-08-28T12:00:00.000Z',
        lastErrorCode: null,
        cleanupStatus: 'NONE',
        cleanupErrorCode: null,
        encryptedAccessToken: 'v1.secret',
      }),
    ).toThrow();
  });
});
