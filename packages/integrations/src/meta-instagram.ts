export interface MetaInstagramClientConfig {
  appId: string;
  appSecret: string;
  graphVersion: string;
  fetch?: typeof fetch;
}

export interface MetaInstagramAuthorizationInput {
  state: string;
  redirectUri: string;
}

export interface MetaInstagramCodeExchangeInput {
  code: string;
  redirectUri: string;
}

export interface MetaInstagramToken {
  accessToken: string;
  expiresIn: number;
  grantedScopes: string[];
}

export interface MetaInstagramIdentity {
  accountId: string;
  username: string | null;
}

export class MetaInstagramError extends Error {
  constructor(
    readonly status: number | null,
    readonly providerCode: number | string | null,
    readonly isTransient: boolean | null = null,
    readonly errorSubcode: number | null = null,
  ) {
    super('Meta Instagram API request failed');
    this.name = 'MetaInstagramError';
  }
}

export class MetaInstagramClient {
  private readonly fetchFn: typeof fetch;
  private readonly graphBaseUrl: URL;

  constructor(private readonly config: MetaInstagramClientConfig) {
    this.fetchFn = config.fetch ?? fetch;
    this.graphBaseUrl = new URL(`https://graph.instagram.com/${config.graphVersion.replace(/^\/+|\/+$/g, '')}/`);
  }

  getAuthorizationUrl(input: MetaInstagramAuthorizationInput): string {
    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.search = new URLSearchParams({
      enable_fb_login: '0',
      force_authentication: '1',
      client_id: this.config.appId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      state: input.state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: MetaInstagramCodeExchangeInput): Promise<MetaInstagramToken> {
    const body = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const payload = await this.requestJson('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const shortLived = parseShortLivedToken(payload);
    const longLivedUrl = new URL('https://graph.instagram.com/access_token');
    longLivedUrl.search = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: this.config.appSecret,
      access_token: shortLived.accessToken,
    }).toString();
    const longLivedPayload = await this.requestJson(longLivedUrl, { method: 'GET' });

    if (!isRecord(longLivedPayload) || typeof longLivedPayload.access_token !== 'string' || typeof longLivedPayload.expires_in !== 'number' || !Number.isFinite(longLivedPayload.expires_in) || longLivedPayload.expires_in <= 0) throw new MetaInstagramError(200, null);
    return {
      accessToken: longLivedPayload.access_token,
      expiresIn: longLivedPayload.expires_in,
      grantedScopes: shortLived.grantedScopes,
    };
  }

  async getIdentity(accessToken: string): Promise<MetaInstagramIdentity> {
    const url = this.graphUrl('me');
    url.searchParams.set('fields', 'user_id,username');
    const payload = await this.requestJson(url, this.authorized(accessToken));

    const entry = isRecord(payload) && Array.isArray(payload.data) ? payload.data[0] : undefined;
    if (!isRecord(entry) || typeof entry.user_id !== 'string' || (entry.username !== undefined && entry.username !== null && typeof entry.username !== 'string')) {
      throw new MetaInstagramError(200, null);
    }
    return { accountId: entry.user_id, username: typeof entry.username === 'string' ? entry.username : null };
  }


  async subscribe(accessToken: string): Promise<void> {
    await this.requestVoid(this.graphUrl('me/subscribed_apps'), {
      ...this.authorized(accessToken),
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ subscribed_fields: 'messages' }),
    });
  }

  async unsubscribe(accessToken: string): Promise<void> {
    await this.requestVoid(this.graphUrl('me/subscribed_apps'), { ...this.authorized(accessToken), method: 'DELETE' });
  }

  async revoke(accessToken: string): Promise<void> {
    await this.requestVoid(this.graphUrl('me/permissions'), { ...this.authorized(accessToken), method: 'DELETE' });
  }

  private graphUrl(path: string): URL {
    return new URL(path, this.graphBaseUrl);
  }

  private authorized(accessToken: string): RequestInit {
    return { headers: { authorization: `Bearer ${accessToken}` } };
  }

  private async requestJson(url: URL | string, init: RequestInit): Promise<unknown> {
    const response = await this.request(url, init);
    try {
      return await response.json();
    } catch {
      throw new MetaInstagramError(response.status, null);
    }
  }

  private async requestVoid(url: URL | string, init: RequestInit): Promise<void> {
    const response = await this.request(url, init);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MetaInstagramError(response.status, null);
    }
    if (!isRecord(payload) || payload.success !== true) {
      throw new MetaInstagramError(response.status, null);
    }
  }

  private async request(url: URL | string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new MetaInstagramError(null, null);
    }

    if (response.ok) return response;
    throw await this.providerError(response);
  }

  private async providerError(response: Response): Promise<MetaInstagramError> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    return new MetaInstagramError(
      response.status,
      providerCode(payload),
      providerIsTransient(payload),
      providerErrorSubcode(payload),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function providerCode(payload: unknown): number | string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const { code } = payload.error;
  return typeof code === 'number' || typeof code === 'string' ? code : null;
}

function providerIsTransient(payload: unknown): boolean | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.is_transient === 'boolean' ? payload.error.is_transient : null;
}

function providerErrorSubcode(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const { error_subcode: errorSubcode } = payload.error;
  return typeof errorSubcode === 'number' && Number.isInteger(errorSubcode) ? errorSubcode : null;
}

function parseShortLivedToken(payload: unknown): { accessToken: string; grantedScopes: string[] } {
  const entry = isRecord(payload) && Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (
    !isRecord(entry) ||
    typeof entry.access_token !== 'string' ||
    typeof entry.user_id !== 'string' ||
    typeof entry.permissions !== 'string'
  ) {
    throw new MetaInstagramError(200, null);
  }
  return {
    accessToken: entry.access_token,
    grantedScopes: [...new Set(entry.permissions.split(',').map((scope) => scope.trim()).filter(Boolean))].sort(),
  };
}
