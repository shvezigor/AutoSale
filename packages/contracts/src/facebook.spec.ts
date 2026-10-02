import { describe, expect, it } from 'vitest';

import {
  facebookConnectionSummarySchema,
  facebookPageCandidateSchema,
  facebookPageSelectionInputSchema,
} from './facebook.js';

describe('Facebook Messenger contracts', () => {
  it('keeps the connection summary token-free and closed', () => {
    const parsed = facebookConnectionSummarySchema.parse({
      status: 'ACTIVE',
      pageId: 'fictional-page-1',
      pageName: 'Fictional Shop',
      tokenExpiresAt: null,
      lastVerifiedAt: '2026-10-02T20:00:00.000Z',
      lastErrorCode: null,
      cleanupStatus: 'NONE',
      cleanupErrorCode: null,
    });

    expect(parsed.pageName).toBe('Fictional Shop');
    expect(Object.keys(parsed)).not.toContain('accessToken');
    expect(() => facebookConnectionSummarySchema.parse({ ...parsed, accessToken: 'secret' })).toThrow();
  });

  it('validates safe Page candidates and an exact selection input', () => {
    expect(facebookPageCandidateSchema.parse({ pageId: 'page-1', pageName: 'Fictional One' }))
      .toEqual({ pageId: 'page-1', pageName: 'Fictional One' });
    expect(facebookPageSelectionInputSchema.parse({
      attemptId: '11111111-1111-4111-8111-111111111111',
      pageId: 'page-1',
    })).toEqual({
      attemptId: '11111111-1111-4111-8111-111111111111',
      pageId: 'page-1',
    });
    expect(() => facebookPageSelectionInputSchema.parse({ attemptId: 'bad', pageId: '' })).toThrow();
  });
});
