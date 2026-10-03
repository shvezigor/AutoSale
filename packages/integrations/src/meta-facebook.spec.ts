import { describe, expect, it, vi } from 'vitest';

import { MetaFacebookClient, MetaFacebookError } from './meta-facebook.js';

const config = {
  appId: '123456789012345',
  appSecret: 'app-secret-that-must-not-leak',
  graphVersion: 'v24.0',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MetaFacebookClient', () => {
  it('requests only the approved Messenger Page scopes', () => {
    const client = new MetaFacebookClient(config);
    const url = new URL(client.getAuthorizationUrl({
      state: 'one-time-state',
      redirectUri: 'https://example.test/api/integrations/facebook/callback',
    }));

    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe(config.appId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('one-time-state');
    expect(url.searchParams.get('scope')?.split(',').sort()).toEqual([
      'pages_manage_metadata',
      'pages_messaging',
      'pages_show_list',
    ]);
  });

  it('exchanges a code without placing the app secret in an authorization header', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      access_token: 'user-token-that-must-not-leak',
      token_type: 'bearer',
      expires_in: 5_184_000,
    }));
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    await expect(client.exchangeCode({
      code: 'authorization-code-that-must-not-leak',
      redirectUri: 'https://example.test/api/integrations/facebook/callback',
    })).resolves.toEqual({ accessToken: 'user-token-that-must-not-leak', expiresIn: 5_184_000 });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v24.0/oauth/access_token');
    expect(url.searchParams.get('client_secret')).toBe(config.appSecret);
    expect(init?.headers).toBeUndefined();
  });

  it('returns only Pages that expose the messaging task', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: [
        { id: 'page-1', name: 'Fictional Shop', access_token: 'page-token-1', tasks: ['MESSAGING', 'ANALYZE'] },
        { id: 'page-2', name: 'Fictional Catalog', access_token: 'page-token-2', tasks: ['ANALYZE'] },
      ],
    }));
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    await expect(client.listEligiblePages('user-token')).resolves.toEqual([{
      pageId: 'page-1',
      pageName: 'Fictional Shop',
      pageAccessToken: 'page-token-1',
      tasks: ['ANALYZE', 'MESSAGING'],
    }]);
    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe('https://graph.facebook.com/v24.0/me/accounts?fields=id%2Cname%2Caccess_token%2Ctasks');
    expect(String(requestUrl)).not.toContain('user-token');
    expect(init).toMatchObject({ headers: { authorization: 'Bearer user-token' } });
  });

  it('rejects a malformed Page list without leaking its body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: [{ id: 7, name: 'Private name', access_token: 'secret-page-token', tasks: ['MESSAGING'] }],
    }));
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    const error = await client.listEligiblePages('user-token').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'MetaFacebookError', responseStage: 'PAGES' });
    expect(String(error)).not.toContain('secret-page-token');
    expect(String(error)).not.toContain('Private name');
  });

  it('verifies the exact Page identity with a bearer token', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'page-1', name: 'Fictional Shop' }));
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    await expect(client.verifyPage('page-1', 'page-token')).resolves.toEqual({
      pageId: 'page-1',
      pageName: 'Fictional Shop',
    });
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer page-token' } });
  });

  it('subscribes and unsubscribes the Page messages field', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ success: true }));
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    await client.subscribePage('page-1', 'page-token');
    await client.unsubscribePage('page-1', 'page-token');

    expect(fetchFn.mock.calls[0]?.[0]?.toString()).toBe('https://graph.facebook.com/v24.0/page-1/subscribed_apps');
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer page-token',
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toBe('subscribed_fields=messages');
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('normalizes provider and network failures without retaining response bodies', async () => {
    const provider = new MetaFacebookClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(response({
        error: { message: 'page-token-that-must-not-leak', code: 190, error_subcode: 463, is_transient: false },
      }, 401)),
    });
    await expect(provider.verifyPage('page-1', 'page-token')).rejects.toEqual(expect.objectContaining({
      name: 'MetaFacebookError',
      status: 401,
      providerCode: 190,
      errorSubcode: 463,
      isTransient: false,
      responseStage: 'PAGE',
    }));

    const network = new MetaFacebookClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('app-secret-that-must-not-leak')),
    });
    await expect(network.listEligiblePages('user-token')).rejects.toEqual(expect.objectContaining({
      name: 'MetaFacebookError', status: null, responseStage: 'PAGES',
    }));
  });

  it('rejects unsafe Page ids before network access', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new MetaFacebookClient({ ...config, fetch: fetchFn });

    await expect(client.verifyPage('../me', 'page-token')).rejects.toThrow('Invalid Facebook Page id');
    await expect(client.subscribePage('', 'page-token')).rejects.toThrow('Invalid Facebook Page id');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses a safe stable error message', () => {
    const error = new MetaFacebookError(400, 190, false, 463, 'TOKEN');
    expect(error.message).toBe('Meta Facebook API request failed');
    expect(JSON.stringify(error)).not.toContain(config.appSecret);
  });
});
