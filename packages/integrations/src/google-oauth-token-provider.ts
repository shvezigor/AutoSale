import { CredentialCipher } from './credential-cipher.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export type GoogleOAuthConnectionRecord = {
  id: string;
  tenantId: string;
  status: string;
  encryptedRefreshToken: string | null;
  credentialGenerationId: string | null;
};

export interface GoogleOAuthConnectionRepository {
  findConnection(connectionId: string, tenantId: string): Promise<GoogleOAuthConnectionRecord | null>;
  markReauthorizationRequired(tenantId: string, credentialGenerationId: string): Promise<void>;
}

export class GoogleOAuthAccessError extends Error {
  override readonly name = 'GoogleOAuthAccessError';
  readonly code = 'AUTHORIZATION' as const;
  readonly retryable = false;

  constructor() { super('Google access is not authorized'); }
}

export class GoogleOAuthTokenProvider {
  constructor(
    private readonly repository: GoogleOAuthConnectionRepository,
    private readonly cipher: CredentialCipher,
    private readonly credentials: { clientId: string; clientSecret: string },
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getAccessToken(connectionId: string, tenantId: string): Promise<string> {
    const connection = await this.repository.findConnection(connectionId, tenantId);
    if (connection?.status !== 'ACTIVE' || !connection.encryptedRefreshToken || !connection.credentialGenerationId) {
      throw new GoogleOAuthAccessError();
    }
    try {
      const response = await this.fetchFn(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          refresh_token: this.cipher.decrypt(connection.encryptedRefreshToken),
          grant_type: 'refresh_token',
        }),
      });
      if (!response.ok) throw new Error('refresh rejected');
      const body = await response.json() as { access_token?: unknown };
      if (typeof body.access_token !== 'string') throw new Error('refresh response invalid');
      return body.access_token;
    } catch {
      await this.repository.markReauthorizationRequired(tenantId, connection.credentialGenerationId);
      throw new GoogleOAuthAccessError();
    }
  }
}
