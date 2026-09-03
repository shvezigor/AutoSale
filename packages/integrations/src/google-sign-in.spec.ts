import { describe, expect, it, vi } from 'vitest';

import { GoogleSignInClient } from './google-sign-in.js';

const configuration = {
  clientId: '123456789.apps.googleusercontent.com',
  clientSecret: 'google-client-secret',
  redirectUri: 'https://sales-aito.com/api/auth/google/callback',
};

describe('GoogleSignInClient', () => {
  it('requests only identity scopes and binds the callback and state', () => {
    const client = new GoogleSignInClient(configuration);

    const url = new URL(client.getAuthorizationUrl({ state: 'opaque-state' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(configuration.redirectUri);
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.search).not.toMatch(/drive|spreadsheets/i);
  });

  it('returns only a normalized verified identity after code exchange', async () => {
    const oauth = oauthDouble({
      iss: 'https://accounts.google.com',
      aud: configuration.clientId,
      sub: 'google-subject',
      email: ' Owner@Example.com ',
      email_verified: true,
      name: ' Owner ',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const client = new GoogleSignInClient(configuration, oauth as never);

    await expect(client.exchangeAndVerify('authorization-code')).resolves.toEqual({
      subject: 'google-subject', email: 'owner@example.com', name: 'Owner',
    });
  });

  it.each([
    ['an unverified email', { email_verified: false }],
    ['a wrong issuer', { iss: 'https://evil.example' }],
    ['a wrong audience', { aud: 'another-client' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['a missing subject', { sub: undefined }],
  ])('rejects %s', async (_label, override) => {
    const oauth = oauthDouble({
      iss: 'accounts.google.com',
      aud: configuration.clientId,
      sub: 'google-subject',
      email: 'owner@example.com',
      email_verified: true,
      name: 'Owner',
      exp: Math.floor(Date.now() / 1000) + 600,
      ...override,
    });
    const client = new GoogleSignInClient(configuration, oauth as never);

    await expect(client.exchangeAndVerify('authorization-code')).rejects.toThrow('Google identity response invalid');
  });
});

function oauthDouble(payload: Record<string, unknown>) {
  return {
    generateAuthUrl: vi.fn(),
    getToken: vi.fn().mockResolvedValue({ tokens: { id_token: 'signed-id-token', access_token: 'not-returned' } }),
    verifyIdToken: vi.fn().mockResolvedValue({ getPayload: () => payload }),
  };
}
