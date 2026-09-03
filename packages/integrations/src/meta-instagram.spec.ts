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

const documentedShortLivedTokenEnvelope = {
  data: [{
    access_token: 'short-lived-token',
    user_id: '10200000000000000',
    permissions: 'instagram_business_basic,instagram_business_manage_messages',
  }],
};

const documentedIdentityEnvelope = {
  data: [{
    user_id: '17841400000000000',
    username: 'shop_account',
  }],
};

const documentedTransientMetaErrorEnvelope = {
  error: {
    message: 'Temporary provider failure that must not be retained',
    type: 'OAuthException',
    code: 2,
    error_subcode: 2207051,
    is_transient: true,
    fbtrace_id: 'trace-transient',
  },
};

const documentedNonTransientMetaErrorEnvelope = {
  error: {
    message: 'Invalid OAuth access token that must not be retained',
    type: 'OAuthException',
    code: 190,
    error_subcode: 463,
    is_transient: false,
    fbtrace_id: 'trace-invalid-token',
  },
};

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

  it('exchanges the code and its short-lived token for a long-lived token', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(documentedShortLivedTokenEnvelope))
      .mockResolvedValueOnce(response({ access_token: 'long-lived-token', expires_in: 5_184_000 }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    })).resolves.toEqual({ accessToken: 'long-lived-token', expiresIn: 5_184_000, grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'] });

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

    const [longLivedUrl, longLivedInit] = fetchFn.mock.calls[1] ?? [];
    const url = new URL(String(longLivedUrl));
    expect(url.origin + url.pathname).toBe('https://graph.instagram.com/access_token');
    expect(longLivedInit?.method).toBe('GET');
    expect(url.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(url.searchParams.get('client_secret')).toBe('app-secret-that-must-not-leak');
    expect(url.searchParams.get('access_token')).toBe('short-lived-token');
  });

  it('rejects a long-lived token response without a positive expiry', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response(documentedShortLivedTokenEnvelope))
        .mockResolvedValueOnce(response({ access_token: 'long-lived-token' })),
    });

    await expect(client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' })).rejects.toEqual(expect.objectContaining({ name: 'MetaInstagramError', status: 200, responseStage: 'LONG_LIVED_TOKEN' }));
  });

  it('gets the professional account identity from graph.instagram.com without putting the token in the URL', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response(documentedIdentityEnvelope));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.getIdentity('access-token-that-must-not-leak')).resolves.toEqual({
      accountId: '17841400000000000',
      username: 'shop_account',
    });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.instagram.com/v24.0/me?fields=user_id%2Cusername');
    expect(String(requestUrl)).not.toContain('access-token-that-must-not-leak');
    expect(init).toMatchObject({ headers: { authorization: 'Bearer access-token-that-must-not-leak' } });
  });

  it('gets a messaging participant profile with a bearer token outside the URL', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      id: 'ig-user-100',
      name: '  Olena Koval  ',
      username: 'olena.koval',
      profile_pic: 'https://scontent.cdninstagram.com/avatar.jpg',
    }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(
      client.getUserProfile('ig-user-100', 'profile-token-that-must-not-leak'),
    ).resolves.toEqual({
      name: '  Olena Koval  ',
      username: 'olena.koval',
      profilePictureUrl: 'https://scontent.cdninstagram.com/avatar.jpg',
    });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(
      'https://graph.instagram.com/v24.0/ig-user-100?fields=name%2Cusername%2Cprofile_pic',
    );
    expect(String(requestUrl)).not.toContain('profile-token-that-must-not-leak');
    expect(init).toMatchObject({
      headers: { authorization: 'Bearer profile-token-that-must-not-leak' },
    });
  });

  it('accepts profile fields that Meta omits or returns as null', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'ig-user-100', name: null })),
    });

    await expect(client.getUserProfile('ig-user-100', 'access-token')).resolves.toEqual({
      name: null,
      username: null,
      profilePictureUrl: null,
    });
  });

  it('rejects malformed participant ids before making a profile request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.getUserProfile('../me', 'access-token')).rejects.toThrow(
      'Invalid Instagram participant id',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses permissions from code exchange without a separate permissions request', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(documentedShortLivedTokenEnvelope))
      .mockResolvedValueOnce(response({ access_token: 'long-lived-token', expires_in: 60 }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://graph.instagram.com/v24.0/me/permissions',
    );
  });

  it('accepts the top-level short-lived token shape returned by Instagram Login', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({
        access_token: 'short-lived-token',
        user_id: 17841400379535404,
        permissions: ['instagram_business_basic', 'instagram_business_manage_messages'],
      }))
      .mockResolvedValueOnce(response({ access_token: 'long-lived-token', expires_in: 60 }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await expect(client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' })).resolves.toEqual({
      accessToken: 'long-lived-token',
      expiresIn: 60,
      grantedScopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    });
  });

  it.each([
    { data: [] },
    { data: [{}] },
    { data: [{ access_token: 'short-lived-token', user_id: '10200000000000000', permission: 'instagram_business_basic', status: 'granted' }] },
  ])('rejects malformed or Facebook-style permission payloads', async (payload) => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(payload)),
    });
    await expect(client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' })).rejects.toEqual(expect.objectContaining({ name: 'MetaInstagramError', status: 200, providerCode: null, responseStage: 'SHORT_LIVED_TOKEN' }));
  });

  it.each([
    {
      access_token: 'short-lived-token',
      data: [{ user_id: '10200000000000000', permissions: 'instagram_business_basic,instagram_business_manage_messages' }],
    },
    {
      data: [
        { access_token: 'short-lived-token', user_id: '10200000000000000' },
        { permissions: 'instagram_business_basic,instagram_business_manage_messages' },
      ],
    },
    {
      data: [{ access_token: 'short-lived-token', permissions: 'instagram_business_basic,instagram_business_manage_messages' }],
    },
  ])('rejects top-level, split-entry, or incomplete short-lived token alternatives', async (payload) => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(payload)),
    });

    await expect(client.exchangeCode({ code: 'code', redirectUri: 'https://example.test/callback' })).rejects.toEqual(expect.objectContaining({ name: 'MetaInstagramError', status: 200, providerCode: null, responseStage: 'SHORT_LIVED_TOKEN' }));
  });

  it('accepts the top-level identity shape returned by Instagram Login', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ user_id: '17841400000000000', username: 'shop_account' })),
    });

    await expect(client.getIdentity('access-token')).resolves.toEqual({
      accountId: '17841400000000000',
      username: 'shop_account',
    });
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

  it('accepts a repeated documented success response for unsubscribe replay', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => response({ success: true }));
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });

    await client.unsubscribe('access-token');
    await expect(client.unsubscribe('access-token')).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.every(([, init]) => init?.method === 'DELETE')).toBe(true);
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

  it.each(['subscribe', 'unsubscribe', 'revoke'] as const)('requires Meta success=true for %s side effects', async (operation) => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ success: false })),
    });

    await expect(client[operation]('access-token')).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 200, providerCode: null,
    }));
  });

  it('preserves the documented invalid-token code for cleanup replay normalization', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({
        error: { code: 190, message: 'Invalid OAuth access token' },
      }, 400)),
    });

    await expect(client.revoke('revoked-token')).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 400, providerCode: 190, isTransient: null, errorSubcode: null,
    }));
  });

  it.each([
    ['transient', documentedTransientMetaErrorEnvelope, 503, 2, true, 2207051],
    ['non-transient invalid token', documentedNonTransientMetaErrorEnvelope, 400, 190, false, 463],
  ])('parses the documented Meta %s error envelope into sanitized retry metadata', async (_name, envelope, status, providerCode, isTransient, errorSubcode) => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response(envelope, status)),
    });

    const failure = client.getIdentity('access-token-that-must-not-leak');

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status, providerCode, isTransient, errorSubcode,
    }));
    await expect(failure).rejects.not.toThrow('Temporary provider failure that must not be retained');
    await expect(failure).rejects.not.toThrow('Invalid OAuth access token that must not be retained');
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

  it('sanitizes an aborted provider request without leaking credentials', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('Abort access-token-that-must-not-leak authorization-code-that-must-not-leak app-secret-that-must-not-leak', 'AbortError');
    });
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });
    const failure = client.getIdentity('access-token-that-must-not-leak');

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: null, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });

  it('sanitizes a long-lived-token transport failure without leaking query credentials', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response(documentedShortLivedTokenEnvelope))
        .mockRejectedValueOnce(new Error('https://graph.instagram.com/access_token?client_secret=app-secret-that-must-not-leak&access_token=short-lived-token&code=authorization-code-that-must-not-leak')),
    });
    const failure = client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    });

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: null, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('short-lived-token');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });

  it('sanitizes an aborted initial token exchange without leaking credentials', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('Abort access-token-that-must-not-leak authorization-code-that-must-not-leak app-secret-that-must-not-leak', 'AbortError');
    });
    const client = new MetaInstagramClient({ ...config, fetch: fetchFn });
    const failure = client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    });

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: null, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });

  it('sanitizes malformed successful JSON during the initial token exchange', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('access-token-that-must-not-leak authorization-code-that-must-not-leak app-secret-that-must-not-leak', { status: 200 })),
    });
    const failure = client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    });

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 200, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });

  it('sanitizes a malformed successful payload during the long-lived token exchange', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>()
        .mockResolvedValueOnce(response(documentedShortLivedTokenEnvelope))
        .mockResolvedValueOnce(response({ access_token: ['access-token-that-must-not-leak'], expires_in: 'app-secret-that-must-not-leak', code: 'authorization-code-that-must-not-leak' })),
    });
    const failure = client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://demo.ngrok-free.app/api/integrations/instagram/callback',
    });

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 200, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('authorization-code-that-must-not-leak');
    await expect(failure).rejects.not.toThrow('app-secret-that-must-not-leak');
  });

  it('sanitizes a malformed successful JSON response', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('access-token-that-must-not-leak', { status: 200 })),
    });
    const failure = client.getIdentity('access-token-that-must-not-leak');

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 200, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
  });

  it('sanitizes a malformed successful JSON payload', async () => {
    const client = new MetaInstagramClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ user_id: 123, username: ['access-token-that-must-not-leak'] }] })),
    });
    const failure = client.getIdentity('access-token-that-must-not-leak');

    await expect(failure).rejects.toEqual(expect.objectContaining({
      name: 'MetaInstagramError', status: 200, providerCode: null,
    }));
    await expect(failure).rejects.not.toThrow('access-token-that-must-not-leak');
  });
});
