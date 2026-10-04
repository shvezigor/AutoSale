import { describe, expect, it, vi } from 'vitest';

import {
  TikTokBusinessMessagingClient,
  TikTokBusinessMessagingError,
} from './tiktok-business-messaging.js';

const config = {
  clientId: 'fictional-tiktok-client',
  clientSecret: 'fictional-tiktok-client-secret',
  authorizationUrl: 'https://business-api.tiktok.com/portal/auth?app_id=fictional-app',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function success(data: unknown): Response {
  return jsonResponse({ code: 0, message: 'OK', request_id: 'fictional-request-id', data });
}

function tokenData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'fictional-access-token',
    token_type: 'Bearer',
    scope: 'message.list.manage,message.list.read,message.list.send,user.account.type',
    expires_in: 86_400,
    refresh_token: 'fictional-refresh-token',
    refresh_token_expires_in: 31_536_000,
    open_id: 'fictional-business-id',
    ...overrides,
  };
}

describe('TikTokBusinessMessagingClient', () => {
  it('reads and reconciles the one app-level DIRECT_MESSAGE webhook', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        code: 0, message: 'OK', request_id: 'request-list',
        data: { app_id: 'fictional-tiktok-client', event_type: 'DIRECT_MESSAGE' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0, message: 'OK', request_id: 'request-update',
        data: {
          app_id: 'fictional-tiktok-client', event_type: 'DIRECT_MESSAGE',
          callback_url: 'https://sales-aito.example/webhooks/tiktok',
        },
      }));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchMock });

    await expect(client.getDirectMessageWebhook()).resolves.toBeNull();
    await expect(client.updateDirectMessageWebhook('https://sales-aito.example/webhooks/tiktok')).resolves.toEqual({
      callbackUrl: 'https://sales-aito.example/webhooks/tiktok',
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('business/webhook/list/');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('event_type=DIRECT_MESSAGE');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      app_id: 'fictional-tiktok-client',
      secret: 'fictional-tiktok-client-secret',
      event_type: 'DIRECT_MESSAGE',
      callback_url: 'https://sales-aito.example/webhooks/tiktok',
    });
  });
  it('adds one-time state to the provider-generated account-holder authorization URL', () => {
    const client = new TikTokBusinessMessagingClient(config);
    const url = new URL(client.getAuthorizationUrl({ state: 'opaque-state' }));

    expect(url.origin + url.pathname).toBe('https://business-api.tiktok.com/portal/auth');
    expect(url.searchParams.get('app_id')).toBe('fictional-app');
    expect(url.searchParams.get('state')).toBe('opaque-state');
  });

  it('exchanges and refreshes account-holder tokens through the documented JSON endpoints', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(success(tokenData()))
      .mockResolvedValueOnce(success(tokenData({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
      })));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    await expect(client.exchangeCode({
      code: 'fictional-auth-code',
      redirectUri: 'https://sales-aito.test/api/integrations/tiktok/callback/',
    })).resolves.toMatchObject({
      accessToken: 'fictional-access-token',
      refreshToken: 'fictional-refresh-token',
      accountId: 'fictional-business-id',
      expiresIn: 86_400,
    });
    await expect(client.refreshToken('fictional-refresh-token')).resolves.toMatchObject({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
    });

    expect(fetchFn.mock.calls[0]?.[0]?.toString()).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/',
    );
    expect(fetchFn.mock.calls[1]?.[0]?.toString()).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/',
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      auth_code: 'fictional-auth-code',
      redirect_uri: 'https://sales-aito.test/api/integrations/tiktok/callback/',
    });
  });

  it('revokes only the merchant token and never exposes it in headers', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(success({}));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    await expect(client.revokeToken('fictional-access-token')).resolves.toBeUndefined();

    expect(fetchFn.mock.calls[0]?.[0]?.toString()).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/revoke/',
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      access_token: 'fictional-access-token',
    });
  });

  it('loads the exact Business Account with Access-Token authentication', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(success({
      display_name: 'Fictional TikTok Shop',
      username: 'fictional_shop',
      profile_image: 'https://cdn.example.invalid/avatar.png',
      is_business_account: true,
    }));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    await expect(client.getAccount('fictional-access-token', 'fictional-business-id')).resolves.toEqual({
      accountId: 'fictional-business-id',
      displayName: 'Fictional TikTok Shop',
      username: 'fictional_shop',
      profileImageUrl: 'https://cdn.example.invalid/avatar.png',
    });

    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.origin + url.pathname).toBe('https://business-api.tiktok.com/open_api/v1.3/business/get/');
    expect(url.searchParams.get('business_id')).toBe('fictional-business-id');
    expect(init?.headers).toEqual({ 'Access-Token': 'fictional-access-token' });
  });

  it('derives account-level inbound and outbound readiness from inspected token scopes', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(success({
        app_id: config.clientId,
        creator_id: 'fictional-business-id',
        scope: 'message.list.manage,message.list.read,user.account.type',
      }))
      .mockResolvedValueOnce(success({
        app_id: config.clientId,
        creator_id: 'fictional-business-id',
        scope: 'message.list.manage,message.list.read,message.list.send,user.account.type',
      }));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    await expect(client.getCapabilities('fictional-access-token', 'fictional-business-id')).resolves.toEqual({
      receiveMessages: true,
      sendText: false,
      sendImage: false,
    });
    await expect(client.getCapabilities('fictional-access-token', 'fictional-business-id')).resolves.toEqual({
      receiveMessages: true,
      sendText: true,
      sendImage: true,
    });

    expect(fetchFn.mock.calls[0]?.[0]?.toString()).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/token_info/get/',
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('sends a bounded text reply to an existing TikTok conversation', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(success({
      message_id: 'fictional-provider-message',
    }));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    await expect(client.sendText({
      accessToken: 'fictional-access-token',
      accountId: 'fictional-business-id',
      conversationId: 'fictional-conversation-id',
      text: 'Дякуємо, замовлення прийнято.',
    })).resolves.toEqual({ messageId: 'fictional-provider-message' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchFn.mock.calls[0] ?? [];
    expect(requestUrl?.toString()).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/business/message/send/',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Access-Token': 'fictional-access-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      business_id: 'fictional-business-id',
      recipient_type: 'CONVERSATION',
      recipient: 'fictional-conversation-id',
      message_type: 'TEXT',
      text: { body: 'Дякуємо, замовлення прийнято.' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects invalid send input before contacting TikTok', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });
    const valid = {
      accessToken: 'fictional-access-token',
      accountId: 'fictional-business-id',
      conversationId: 'fictional-conversation-id',
      text: 'Вітаю',
    };

    await expect(client.sendText({ ...valid, text: 'x'.repeat(1001) })).rejects.toThrow('Invalid TikTok message text');
    await expect(client.sendText({ ...valid, conversationId: '' })).rejects.toThrow('Invalid TikTok conversation id');
    await expect(client.sendText({ ...valid, accountId: 'bad\naccount' })).rejects.toThrow('Invalid TikTok account id');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('classifies rate-limit, auth, policy, malformed, and ambiguous TikTok sends', async () => {
    const input = {
      accessToken: 'fictional-access-token',
      accountId: 'fictional-business-id',
      conversationId: 'fictional-conversation-id',
      text: 'Вітаю',
    };
    const errors: Array<{ response: Response | Error; expected: Partial<TikTokBusinessMessagingError> }> = [
      {
        response: jsonResponse({ code: 0, request_id: 'rate-request', data: {} }, 429),
        expected: { stage: 'MESSAGE_SEND', status: 429, retryable: true },
      },
      {
        response: jsonResponse({ code: 40105, request_id: 'auth-request', data: {} }, 401),
        expected: { stage: 'MESSAGE_SEND', status: 401, providerCode: 40105, retryable: false },
      },
      {
        response: jsonResponse({ code: 40001, request_id: 'policy-request', data: {} }),
        expected: { stage: 'MESSAGE_SEND', status: 200, providerCode: 40001, retryable: false },
      },
      {
        response: success({}),
        expected: { stage: 'MESSAGE_SEND', status: 200, retryable: false },
      },
      {
        response: new Error('network body and token must stay redacted'),
        expected: { stage: 'MESSAGE_SEND', status: null, retryable: true },
      },
    ];

    for (const scenario of errors) {
      const fetchFn = scenario.response instanceof Response
        ? vi.fn<typeof fetch>().mockResolvedValue(scenario.response)
        : vi.fn<typeof fetch>().mockRejectedValue(scenario.response);
      const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });
      const error = await client.sendText(input).catch((failure: unknown) => failure);
      expect(error).toMatchObject(scenario.expected);
      expect(String(error)).not.toContain(input.accessToken);
      expect(String(error)).not.toContain(input.text);
    }
  });

  it('rejects a token inspection identity mismatch', async () => {
    const client = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(success({
        app_id: config.clientId,
        creator_id: 'another-business-id',
        scope: 'message.list.read',
      })),
    });

    await expect(client.getCapabilities('fictional-access-token', 'fictional-business-id')).rejects.toMatchObject({
      name: 'TikTokBusinessMessagingError',
      stage: 'TOKEN_INFO',
    });
  });

  it('gets a temporary media URL and downloads only supported bounded media', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(success({ download_url: 'https://cdn.example.invalid/media.jpg' }))
      .mockResolvedValueOnce(new Response(bytes, {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) },
      }));
    const client = new TikTokBusinessMessagingClient({ ...config, fetch: fetchFn });

    const media = await client.downloadMedia('fictional-access-token', {
      accountId: 'fictional-business-id',
      conversationId: 'fictional-conversation-id',
      messageId: 'fictional-message-id',
      mediaId: 'fictional-media-id',
      mediaType: 'IMAGE',
    });

    expect(media.contentType).toBe('image/jpeg');
    expect(media.contentLength).toBe(3);
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toEqual({
      'Access-Token': 'fictional-access-token',
      'content-type': 'application/json',
    });
    expect(fetchFn.mock.calls[1]?.[1]?.headers).toEqual({ 'x-user': 'fictional-access-token' });
  });

  it('rejects unsupported or oversized downloaded media before exposing the body', async () => {
    const unsupported = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>()
        .mockResolvedValueOnce(success({ download_url: 'https://cdn.example.invalid/file.html' }))
        .mockResolvedValueOnce(new Response('<html>secret</html>', { headers: { 'content-type': 'text/html' } })),
    });
    await expect(unsupported.downloadMedia('fictional-access-token', {
      accountId: 'fictional-business-id', conversationId: 'conversation', messageId: 'message', mediaId: 'media', mediaType: 'IMAGE',
    })).rejects.toMatchObject({ stage: 'MEDIA_DOWNLOAD' });

    const oversized = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>()
        .mockResolvedValueOnce(success({ download_url: 'https://cdn.example.invalid/video.mp4' }))
        .mockResolvedValueOnce(new Response(null, {
          headers: { 'content-type': 'video/mp4', 'content-length': String(25 * 1024 * 1024 + 1) },
        })),
    });
    await expect(oversized.downloadMedia('fictional-access-token', {
      accountId: 'fictional-business-id', conversationId: 'conversation', messageId: 'message', mediaId: 'media', mediaType: 'VIDEO',
    })).rejects.toMatchObject({ stage: 'MEDIA_DOWNLOAD' });
  });

  it('normalizes provider, malformed-success, and network failures without leaking bodies or tokens', async () => {
    const provider = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        code: 40105,
        message: 'fictional-access-token must not leak',
        request_id: 'provider-request-id',
        data: {},
      })),
    });
    const providerError = await provider.getAccount('fictional-access-token', 'fictional-business-id')
      .catch((error: unknown) => error);
    expect(providerError).toMatchObject({
      name: 'TikTokBusinessMessagingError',
      status: 200,
      providerCode: 40105,
      requestId: 'provider-request-id',
      retryable: false,
      stage: 'ACCOUNT',
    });
    expect(String(providerError)).not.toContain('fictional-access-token');

    const malformed = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(success({ access_token: 'secret-only' })),
    });
    await expect(malformed.exchangeCode({ code: 'code', redirectUri: 'https://sales-aito.test/callback/' }))
      .rejects.toMatchObject({ stage: 'TOKEN' });

    const network = new TikTokBusinessMessagingClient({
      ...config,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('fictional-client-secret must not leak')),
    });
    await expect(network.refreshToken('fictional-refresh-token')).rejects.toMatchObject({
      status: null,
      requestId: null,
      retryable: true,
      stage: 'TOKEN_REFRESH',
    });
  });

  it('uses a stable redacted error message', () => {
    const error = new TikTokBusinessMessagingError('TOKEN', 400, 40002, 'request-id', false);
    expect(error.message).toBe('TikTok Business Messaging API request failed');
    expect(JSON.stringify(error)).not.toContain(config.clientSecret);
  });
});
