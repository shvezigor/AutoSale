export interface MetaFacebookClientConfig {
  appId: string;
  appSecret: string;
  graphVersion: string;
  fetch?: typeof fetch;
}

export interface MetaFacebookAuthorizationInput {
  state: string;
  redirectUri: string;
}

export interface MetaFacebookCodeExchangeInput {
  code: string;
  redirectUri: string;
}

export interface MetaFacebookUserToken {
  accessToken: string;
  expiresIn: number | null;
}

export interface MetaFacebookPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  tasks: string[];
}

export type MetaFacebookResponseStage = 'TOKEN' | 'PAGES' | 'PAGE' | 'SUBSCRIBE' | 'UNSUBSCRIBE';

export const FACEBOOK_PAGE_SCOPES = [
  'pages_manage_metadata',
  'pages_messaging',
  'pages_show_list',
] as const;

export class MetaFacebookError extends Error {
  constructor(
    readonly status: number | null,
    readonly providerCode: number | string | null,
    readonly isTransient: boolean | null,
    readonly errorSubcode: number | null,
    readonly responseStage: MetaFacebookResponseStage,
  ) {
    super('Meta Facebook API request failed');
    this.name = 'MetaFacebookError';
  }
}

export class MetaFacebookClient {
  private readonly fetchFn: typeof fetch;
  private readonly graphBaseUrl: URL;
  private readonly graphVersion: string;

  constructor(private readonly config: MetaFacebookClientConfig) {
    this.fetchFn = config.fetch ?? fetch;
    this.graphVersion = config.graphVersion.replace(/^\/+|\/+$/g, '');
    this.graphBaseUrl = new URL(`https://graph.facebook.com/${this.graphVersion}/`);
  }

  getAuthorizationUrl(input: MetaFacebookAuthorizationInput): string {
    const url = new URL(`https://www.facebook.com/${this.graphVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: FACEBOOK_PAGE_SCOPES.join(','),
      state: input.state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: MetaFacebookCodeExchangeInput): Promise<MetaFacebookUserToken> {
    const url = this.graphUrl('oauth/access_token');
    url.search = new URLSearchParams({
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    }).toString();
    const payload = await this.requestJson(url, { method: 'GET' }, 'TOKEN');
    if (
      !isRecord(payload) ||
      typeof payload.access_token !== 'string' ||
      payload.access_token.length === 0 ||
      (payload.expires_in !== undefined &&
        (typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0))
    ) {
      throw new MetaFacebookError(200, null, null, null, 'TOKEN');
    }
    return {
      accessToken: payload.access_token,
      expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    };
  }

  async listEligiblePages(userAccessToken: string): Promise<MetaFacebookPage[]> {
    const url = this.graphUrl('me/accounts');
    url.searchParams.set('fields', 'id,name,access_token,tasks');
    const payload = await this.requestJson(url, this.authorized(userAccessToken), 'PAGES');
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new MetaFacebookError(200, null, null, null, 'PAGES');
    }

    const pages = payload.data.map((entry): MetaFacebookPage => {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.id) ||
        !isNonEmptyString(entry.name) ||
        !isNonEmptyString(entry.access_token) ||
        !Array.isArray(entry.tasks) ||
        !entry.tasks.every(isNonEmptyString)
      ) {
        throw new MetaFacebookError(200, null, null, null, 'PAGES');
      }
      return {
        pageId: entry.id,
        pageName: entry.name,
        pageAccessToken: entry.access_token,
        tasks: [...new Set(entry.tasks)].sort(),
      };
    });
    return pages.filter((page) => page.tasks.includes('MESSAGING'));
  }

  async verifyPage(pageId: string, pageAccessToken: string): Promise<{ pageId: string; pageName: string }> {
    assertPageId(pageId);
    const url = this.graphUrl(pageId);
    url.searchParams.set('fields', 'id,name');
    const payload = await this.requestJson(url, this.authorized(pageAccessToken), 'PAGE');
    if (!isRecord(payload) || payload.id !== pageId || !isNonEmptyString(payload.name)) {
      throw new MetaFacebookError(200, null, null, null, 'PAGE');
    }
    return { pageId, pageName: payload.name };
  }

  async subscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    assertPageId(pageId);
    await this.requestSuccess(this.graphUrl(`${pageId}/subscribed_apps`), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pageAccessToken}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ subscribed_fields: 'messages' }),
    }, 'SUBSCRIBE');
  }

  async unsubscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    assertPageId(pageId);
    await this.requestSuccess(
      this.graphUrl(`${pageId}/subscribed_apps`),
      { ...this.authorized(pageAccessToken), method: 'DELETE' },
      'UNSUBSCRIBE',
    );
  }

  private graphUrl(path: string): URL {
    return new URL(path, this.graphBaseUrl);
  }

  private authorized(accessToken: string): RequestInit {
    return { headers: { authorization: `Bearer ${accessToken}` } };
  }

  private async requestJson(
    url: URL | string,
    init: RequestInit,
    stage: MetaFacebookResponseStage,
  ): Promise<unknown> {
    const response = await this.request(url, init, stage);
    try {
      return await response.json();
    } catch {
      throw new MetaFacebookError(response.status, null, null, null, stage);
    }
  }

  private async requestSuccess(
    url: URL | string,
    init: RequestInit,
    stage: MetaFacebookResponseStage,
  ): Promise<void> {
    const payload = await this.requestJson(url, init, stage);
    if (!isRecord(payload) || payload.success !== true) {
      throw new MetaFacebookError(200, null, null, null, stage);
    }
  }

  private async request(
    url: URL | string,
    init: RequestInit,
    stage: MetaFacebookResponseStage,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new MetaFacebookError(null, null, null, null, stage);
    }
    if (response.ok) return response;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    throw new MetaFacebookError(
      response.status,
      providerCode(payload),
      providerIsTransient(payload),
      providerErrorSubcode(payload),
      stage,
    );
  }
}

function assertPageId(pageId: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(pageId)) {
    throw new Error('Invalid Facebook Page id');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function providerCode(payload: unknown): number | string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.code === 'number' || typeof payload.error.code === 'string'
    ? payload.error.code
    : null;
}

function providerIsTransient(payload: unknown): boolean | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.is_transient === 'boolean' ? payload.error.is_transient : null;
}

function providerErrorSubcode(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.error_subcode === 'number' && Number.isInteger(payload.error.error_subcode)
    ? payload.error.error_subcode
    : null;
}
