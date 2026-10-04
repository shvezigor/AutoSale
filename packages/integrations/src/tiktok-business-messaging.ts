import type { TikTokCapabilities } from '@autosale/contracts/tiktok';

const API_BASE_URL = new URL('https://business-api.tiktok.com/open_api/v1.3/');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const RETRYABLE_PROVIDER_CODES = new Set([40100, 51065]);

export interface TikTokBusinessMessagingClientConfig {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  fetch?: typeof fetch;
}

export interface TikTokAuthorizationInput {
  state: string;
}

export interface TikTokCodeExchangeInput {
  code: string;
  redirectUri: string;
}

export interface TikTokAccountToken {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  grantedScopes: string[];
  expiresIn: number;
  refreshTokenExpiresIn: number;
}

export interface TikTokBusinessAccount {
  accountId: string;
  displayName: string;
  username: string;
  profileImageUrl: string | null;
}

export type TikTokMediaType = 'IMAGE' | 'VIDEO';

export interface TikTokMediaDownloadInput {
  accountId: string;
  conversationId: string;
  messageId: string;
  mediaId: string;
  mediaType: TikTokMediaType;
}

export interface TikTokDownloadedMedia {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
}

export interface TikTokDirectMessageWebhook {
  callbackUrl: string;
}

export interface TikTokTextMessageInput {
  accessToken: string;
  accountId: string;
  conversationId: string;
  text: string;
}

export type TikTokBusinessMessagingStage =
  | 'TOKEN'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REVOKE'
  | 'TOKEN_INFO'
  | 'ACCOUNT'
  | 'MESSAGE_SEND'
  | 'MEDIA_URL'
  | 'MEDIA_DOWNLOAD'
  | 'WEBHOOK_GET'
  | 'WEBHOOK_UPDATE';

export class TikTokBusinessMessagingError extends Error {
  constructor(
    readonly stage: TikTokBusinessMessagingStage,
    readonly status: number | null,
    readonly providerCode: number | string | null,
    readonly requestId: string | null,
    readonly retryable: boolean,
  ) {
    super('TikTok Business Messaging API request failed');
    this.name = 'TikTokBusinessMessagingError';
  }
}

export class TikTokBusinessMessagingClient {
  private readonly fetchFn: typeof fetch;
  private readonly authorizationUrl: URL;

  constructor(private readonly config: TikTokBusinessMessagingClientConfig) {
    this.fetchFn = config.fetch ?? fetch;
    this.authorizationUrl = new URL(config.authorizationUrl);
    if (
      this.authorizationUrl.protocol !== 'https:' ||
      !['business-api.tiktok.com', 'ads.tiktok.com'].includes(this.authorizationUrl.hostname)
    ) {
      throw new Error('Invalid TikTok authorization URL');
    }
  }

  getAuthorizationUrl(input: TikTokAuthorizationInput): string {
    if (!isNonEmptyString(input.state) || input.state.length > 1024) {
      throw new Error('Invalid TikTok OAuth state');
    }
    const url = new URL(this.authorizationUrl);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async getDirectMessageWebhook(): Promise<TikTokDirectMessageWebhook | null> {
    const url = this.apiUrl('business/webhook/list/');
    url.searchParams.set('app_id', this.config.clientId);
    url.searchParams.set('secret', this.config.clientSecret);
    url.searchParams.set('event_type', 'DIRECT_MESSAGE');
    const data = await this.requestEnvelope(url, { method: 'GET' }, 'WEBHOOK_GET');
    if (!isRecord(data) || data.app_id !== this.config.clientId || data.event_type !== 'DIRECT_MESSAGE') {
      throw malformed('WEBHOOK_GET');
    }
    if (data.callback_url === undefined) return null;
    if (!isHttpsUrl(data.callback_url)) throw malformed('WEBHOOK_GET');
    return { callbackUrl: data.callback_url };
  }

  async updateDirectMessageWebhook(callbackUrl: string): Promise<TikTokDirectMessageWebhook> {
    if (!isHttpsUrl(callbackUrl)) throw new Error('Invalid TikTok webhook callback URL');
    const data = await this.requestEnvelope(this.apiUrl('business/webhook/update/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.clientId,
        secret: this.config.clientSecret,
        event_type: 'DIRECT_MESSAGE',
        callback_url: callbackUrl,
      }),
    }, 'WEBHOOK_UPDATE');
    if (
      !isRecord(data) ||
      data.app_id !== this.config.clientId ||
      data.event_type !== 'DIRECT_MESSAGE' ||
      data.callback_url !== callbackUrl
    ) {
      throw malformed('WEBHOOK_UPDATE');
    }
    return { callbackUrl };
  }

  async exchangeCode(input: TikTokCodeExchangeInput): Promise<TikTokAccountToken> {
    return this.requestToken('tt_user/oauth2/token/', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      auth_code: input.code,
      redirect_uri: input.redirectUri,
    }, 'TOKEN');
  }

  async refreshToken(refreshToken: string): Promise<TikTokAccountToken> {
    return this.requestToken('tt_user/oauth2/refresh_token/', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, 'TOKEN_REFRESH');
  }

  async revokeToken(accessToken: string): Promise<void> {
    await this.requestEnvelope(this.apiUrl('tt_user/oauth2/revoke/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        access_token: accessToken,
      }),
    }, 'TOKEN_REVOKE');
  }

  async getAccount(accessToken: string, accountId: string): Promise<TikTokBusinessAccount> {
    assertProviderId(accountId, 'account');
    const url = this.apiUrl('business/get/');
    url.searchParams.set('business_id', accountId);
    url.searchParams.set('fields', JSON.stringify([
      'display_name',
      'username',
      'profile_image',
    ]));
    const data = await this.requestEnvelope(url, this.authorized(accessToken), 'ACCOUNT');
    if (
      !isRecord(data) ||
      !isNonEmptyString(data.display_name) ||
      !isNonEmptyString(data.username) ||
      (data.profile_image !== undefined && data.profile_image !== null && !isHttpsUrl(data.profile_image))
    ) {
      throw malformed('ACCOUNT');
    }
    return {
      accountId,
      displayName: data.display_name,
      username: data.username,
      profileImageUrl: typeof data.profile_image === 'string' ? data.profile_image : null,
    };
  }

  async getCapabilities(
    accessToken: string,
    expectedAccountId: string,
  ): Promise<TikTokCapabilities> {
    assertProviderId(expectedAccountId, 'account');
    const data = await this.requestEnvelope(this.apiUrl('tt_user/token_info/get/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.clientId, access_token: accessToken }),
    }, 'TOKEN_INFO');
    if (
      !isRecord(data) ||
      data.app_id !== this.config.clientId ||
      data.creator_id !== expectedAccountId ||
      typeof data.scope !== 'string'
    ) {
      throw malformed('TOKEN_INFO');
    }
    const scopes = new Set(parseScopes(data.scope));
    const receiveMessages = scopes.has('message.list.read') && scopes.has('message.list.manage');
    const canSend = scopes.has('message.list.send');
    return {
      receiveMessages,
      sendText: canSend,
      sendImage: canSend,
    };
  }

  async sendText(input: TikTokTextMessageInput): Promise<{ messageId: string }> {
    if (!isNonEmptyString(input.accessToken)) throw new Error('Invalid TikTok access token');
    assertProviderId(input.accountId, 'account');
    assertProviderId(input.conversationId, 'conversation');
    const text = input.text.trim();
    if (text.length === 0 || text.length > 1_000) throw new Error('Invalid TikTok message text');

    const data = await this.requestEnvelope(this.apiUrl('business/message/send/'), {
      method: 'POST',
      headers: { 'Access-Token': input.accessToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        business_id: input.accountId,
        recipient_type: 'CONVERSATION',
        recipient: input.conversationId,
        message_type: 'TEXT',
        text: { body: text },
      }),
    }, 'MESSAGE_SEND');
    if (!isRecord(data) || !isNonEmptyString(data.message_id)) {
      throw malformed('MESSAGE_SEND');
    }
    return { messageId: data.message_id };
  }

  async downloadMedia(
    accessToken: string,
    input: TikTokMediaDownloadInput,
  ): Promise<TikTokDownloadedMedia> {
    assertProviderId(input.accountId, 'account');
    assertProviderId(input.conversationId, 'conversation');
    assertProviderId(input.messageId, 'message');
    assertProviderId(input.mediaId, 'media');
    const data = await this.requestEnvelope(this.apiUrl('business/message/media/download/'), {
      method: 'POST',
      headers: { 'Access-Token': accessToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        business_id: input.accountId,
        conversation_id: input.conversationId,
        message_id: input.messageId,
        media_id: input.mediaId,
        media_type: input.mediaType,
      }),
    }, 'MEDIA_URL');
    if (!isRecord(data) || !isHttpsUrl(data.download_url)) {
      throw malformed('MEDIA_URL');
    }

    const response = await this.requestRaw(data.download_url, {
      headers: { 'x-user': accessToken },
    }, 'MEDIA_DOWNLOAD');
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    const allowedTypes = input.mediaType === 'IMAGE'
      ? new Set(['image/jpeg', 'image/png'])
      : new Set(['video/mp4']);
    const maximumBytes = input.mediaType === 'IMAGE' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      !allowedTypes.has(contentType) ||
      (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBytes)) ||
      response.body === null
    ) {
      throw malformed('MEDIA_DOWNLOAD', response.status);
    }
    return { body: response.body, contentType, contentLength };
  }

  private async requestToken(
    path: string,
    body: Record<string, string>,
    stage: 'TOKEN' | 'TOKEN_REFRESH',
  ): Promise<TikTokAccountToken> {
    const data = await this.requestEnvelope(this.apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, stage);
    if (
      !isRecord(data) ||
      !isNonEmptyString(data.access_token) ||
      data.token_type !== 'Bearer' ||
      typeof data.scope !== 'string' ||
      !isPositiveInteger(data.expires_in) ||
      !isNonEmptyString(data.refresh_token) ||
      !isPositiveInteger(data.refresh_token_expires_in) ||
      !isNonEmptyString(data.open_id)
    ) {
      throw malformed(stage);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accountId: data.open_id,
      grantedScopes: parseScopes(data.scope),
      expiresIn: data.expires_in,
      refreshTokenExpiresIn: data.refresh_token_expires_in,
    };
  }

  private async requestEnvelope(
    url: URL,
    init: RequestInit,
    stage: TikTokBusinessMessagingStage,
  ): Promise<unknown> {
    const response = await this.requestRaw(url, init, stage);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw malformed(stage, response.status);
    }
    if (!isRecord(payload) || !Number.isInteger(payload.code)) {
      throw malformed(stage, response.status);
    }
    const requestId = isNonEmptyString(payload.request_id) ? payload.request_id : null;
    if (payload.code !== 0) {
      const providerCode = payload.code as number;
      throw new TikTokBusinessMessagingError(
        stage,
        response.status,
        providerCode,
        requestId,
        isRetryable(response.status, providerCode),
      );
    }
    if (!('data' in payload)) throw malformed(stage, response.status, requestId);
    return payload.data;
  }

  private async requestRaw(
    url: URL | string,
    init: RequestInit,
    stage: TikTokBusinessMessagingStage,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new TikTokBusinessMessagingError(stage, null, null, null, true);
    }
    if (response.ok) return response;

    let providerCode: number | string | null = null;
    let requestId: string | null = null;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload)) {
        providerCode = typeof payload.code === 'number' || typeof payload.code === 'string' ? payload.code : null;
        requestId = isNonEmptyString(payload.request_id) ? payload.request_id : null;
      }
    } catch {
      // The body is intentionally discarded to keep provider data out of errors.
    }
    throw new TikTokBusinessMessagingError(
      stage,
      response.status,
      providerCode,
      requestId,
      isRetryable(response.status, providerCode),
    );
  }

  private apiUrl(path: string): URL {
    return new URL(path, API_BASE_URL);
  }

  private authorized(accessToken: string): RequestInit {
    return { headers: { 'Access-Token': accessToken } };
  }
}

function malformed(
  stage: TikTokBusinessMessagingStage,
  status = 200,
  requestId: string | null = null,
): TikTokBusinessMessagingError {
  return new TikTokBusinessMessagingError(stage, status, null, requestId, false);
}

function parseScopes(scope: string): string[] {
  return [...new Set(scope.split(',').map((value) => value.trim()).filter(Boolean))].sort();
}

function assertProviderId(value: string, label: string): void {
  if (!isNonEmptyString(value) || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Invalid TikTok ${label} id`);
  }
}

function isRetryable(status: number, providerCode: number | string | null): boolean {
  return status === 429 || status >= 500 || (typeof providerCode === 'number' && RETRYABLE_PROVIDER_CODES.has(providerCode));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
