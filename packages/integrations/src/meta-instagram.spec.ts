import { describe, expect, it, vi } from 'vitest';

import { MetaInstagramClient, MetaInstagramError } from './meta-instagram.js';

const config = {
  appId: 'instagram-app-id',
  appSecret: 'app-secret-that-must-not-leak',
  graphVersion: 'v24.0',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MetaInstagramClient', () => {
  it('builds an Instagram Login authorization URL with only the required scopes', () => {
    const client = new MetaInstagramClient(config);

    const url = new URL(client.getAuthorizationUrl({
      state: 'one-time-state',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    }));

    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('instagram-app-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_messages');
    expect(url.searchParams.get('state')).toBe('one-time-state');
    expect(url.searchParams.get('redirect_uri')).toBe('https://demo.ngrok-free.app/api/integrations/instagram/callback');
  });

  it('exchanges an authorization code with a form POST and returns its expiry', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ access_token: 'long-lived-token', expires_in: 5_184_000 }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    })).resolves.toEqual({ accessToken: 'long-lived-token', expiresIn: 5_184_000 });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://api.instagram.com/oauth/access_token');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(new URLSearchParams(String(init?.body))).toEqual(new URLSearchParams({
      client_id: 'instagram-app-id',
      client_secret: 'app-secret-that-must-not-leak',
      grant_type: 'authorization_code',
      redirect_uri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
      code: 'authorization-code-that-must-not-leak',
    }));
  });

  it('returns a null expiry when the token response omits expires_in', async () => {
    const client = new MetaInstagramClient({ ...config, fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ access_token: 'token' })) });

    await expect(client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' }))
      .resolves.toEqual({ accessToken: 'token', expiresIn: null });
  });

  it('gets the professional account identity from graph.instagram.com without putting the token in the URL', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ id: '17841400000000000', username: 'shop_account' }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.getIdentity('access-token-that-must-not-leak')).resolves.toEqual({
      accountId: '17841400000000000',
      username: 'shop_account',
    });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.instagram.com/v24.0/me?fields=id%2Cusername');
    expect(String(requestUrl)).not.toContain('access-token-that-must-not-leak');
    expect(init).toMatchObject({ headers: { authorization: 'Bearer access-token-that-must-not-leak' } });
  });

  it('subscribes the current account to message webhooks', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.subscribe('access-token')).resolves.toBeUndefined();

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.instagram.com/v24.0/me/subscribed_apps');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ authorization: 'Bearer access-token', 'content-type': 'application/x-www-form-urlencoded' });
    expect(String(init?.body)).toBe('subscribed_fields=messages');
  });

  it('unsubscribes the current account from webhooks', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.unsubscribe('access-token')).resolves.toBeUndefined();

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.instagram.com/v24.0/me/subscribed_apps');
    expect(init?.method).toBe('DELETE');
    expect(init?.headers).toEqual({ authorization: 'Bearer access-token' });
  });

  it('revokes the current account token', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ success: true }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.revoke('access-token')).resolves.toBeUndefined();

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.instagram.com/v24.0/me/permissions');
    expect(init?.method).toBe('DELETE');
    expect(init?.headers).toEqual({ authorization: 'Bearer access-token' });
  });

  it('sanitizes provider errors to status and provider code', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({
        error: { code: 190, message: 'Rejected access-token-that-must-not-leak authorization-code-that-must-not-leak app-secret-that-must-not-leak' },
      }, 400)),
    });

    const failure = client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    });

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 400, providerCode: 190,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });
});
