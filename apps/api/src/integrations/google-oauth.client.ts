const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const REQUIRED_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'] as const;

export type GoogleTokenIdentity = {
  refreshToken: string | null;
  subject: string;
  email: string | null;
  grantedScopes: string[];
};

export interface GoogleOAuthClientPort {
  getAuthorizationUrl(input: { state: string; accessType: 'offline' }): string;
  exchangeCode(code: string): Promise<GoogleTokenIdentity>;
  refreshAccessToken(refreshToken: string): Promise<string>;
  revokeRefreshToken(token: string): Promise<void>;
}

export class GoogleOAuthClient implements GoogleOAuthClientPort {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  getAuthorizationUrl(input: { state: string; accessType: 'offline' }): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '),
      state: input.state,
      access_type: input.accessType,
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleTokenIdentity> {
    const tokenResponse = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) throw new Error('Google token exchange failed');
    const token = await tokenResponse.json() as { access_token?: unknown; refresh_token?: unknown; scope?: unknown };
    if (typeof token.access_token !== 'string') throw new Error('Google token response invalid');

    const identityResponse = await this.fetchFn(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!identityResponse.ok) throw new Error('Google identity lookup failed');
    const identity = await identityResponse.json() as { sub?: unknown; email?: unknown; email_verified?: unknown };
    if (typeof identity.sub !== 'string') throw new Error('Google identity response invalid');

    return {
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
      subject: identity.sub,
      email: identity.email_verified === true && typeof identity.email === 'string' ? identity.email : null,
      grantedScopes: typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : [],
    };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const response = await this.fetchFn('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok) throw new Error('Google token revocation failed');
  }

  async refreshAccessToken(refreshToken: string): Promise<string> {
    const response = await this.fetchFn(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new Error('Google access token refresh failed');
    const body = await response.json() as { access_token?: unknown };
    if (typeof body.access_token !== 'string') throw new Error('Google access token response invalid');
    return body.access_token;
  }
}
