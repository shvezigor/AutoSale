import { describe, expect, it, vi } from 'vitest';

import { GoogleOAuthClient } from './google-oauth.client.js';

describe('GoogleOAuthClient', () => {
  it('builds an offline authorization URL with only identity and drive.file scopes', () => {
    const client = new GoogleOAuthClient('client-id', 'client-secret', 'https://sales-aito.com/api/integrations/google/callback');

    const url = new URL(client.getAuthorizationUrl({ state: 'opaque-state', accessType: 'offline' }));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual([
      'email',
      'https://www.googleapis.com/auth/drive.file',
      'openid',
    ]);
  });

  it('exchanges the code server-side and trusts only a verified provider email', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', scope: 'openid email https://www.googleapis.com/auth/drive.file' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'subject', email: 'owner@example.com', email_verified: true }), { status: 200 }));
    const client = new GoogleOAuthClient('client-id', 'client-secret', 'https://sales-aito.com/api/integrations/google/callback', fetchFn);

    await expect(client.exchangeCode('code')).resolves.toMatchObject({ refreshToken: 'refresh', subject: 'subject', email: 'owner@example.com' });
    expect(fetchFn.mock.calls[0]?.[1]?.body?.toString()).toContain('client_secret=client-secret');
    expect(fetchFn.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'Bearer access' });
  });

  it('refreshes a short-lived access token without exposing the refresh token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'short-lived' }), { status: 200 }));
    const client = new GoogleOAuthClient('client-id', 'client-secret', 'https://sales-aito.com/api/integrations/google/callback', fetchFn);

    await expect(client.refreshAccessToken('refresh-a')).resolves.toBe('short-lived');
    expect(fetchFn.mock.calls[0]?.[1]?.body?.toString()).toContain('refresh_token=refresh-a');
  });
});
