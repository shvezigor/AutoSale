import { OAuth2Client } from 'google-auth-library';

const ALLOWED_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

export type GoogleSignInIdentity = {
  subject: string;
  email: string;
  name: string;
};

export interface GoogleSignInClientPort {
  getAuthorizationUrl(input: { state: string }): string;
  exchangeAndVerify(code: string): Promise<GoogleSignInIdentity>;
}

export type GoogleSignInClientConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OAuthClient = Pick<OAuth2Client, 'generateAuthUrl' | 'getToken' | 'verifyIdToken'>;

export class GoogleSignInClient implements GoogleSignInClientPort {
  private readonly oauth: OAuthClient;

  constructor(
    private readonly config: GoogleSignInClientConfig,
    oauth?: OAuthClient,
  ) {
    this.oauth = oauth ?? new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  getAuthorizationUrl(input: { state: string }): string {
    return this.oauth.generateAuthUrl({
      access_type: 'online',
      include_granted_scopes: false,
      prompt: 'select_account',
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: IDENTITY_SCOPES,
      state: input.state,
    });
  }

  async exchangeAndVerify(code: string): Promise<GoogleSignInIdentity> {
    const exchanged = await this.oauth.getToken({ code, redirect_uri: this.config.redirectUri });
    const idToken = exchanged.tokens.id_token;
    if (!idToken) throw new Error('Google identity response invalid');

    const ticket = await this.oauth.verifyIdToken({ idToken, audience: this.config.clientId });
    const payload = ticket.getPayload();
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !payload
      || !ALLOWED_ISSUERS.has(payload.iss)
      || payload.aud !== this.config.clientId
      || typeof payload.exp !== 'number'
      || payload.exp <= nowSeconds
      || typeof payload.sub !== 'string'
      || !payload.sub.trim()
      || payload.email_verified !== true
      || typeof payload.email !== 'string'
      || !payload.email.trim()
    ) {
      throw new Error('Google identity response invalid');
    }

    const email = payload.email.trim().toLowerCase();
    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email.split('@')[0] ?? 'Google user';

    return { subject: payload.sub, email, name };
  }
}
