import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { CredentialCipher } from './credential-cipher.js';
import { GoogleOAuthTokenProvider } from './google-oauth-token-provider.js';

describe('GoogleOAuthTokenProvider', () => {
  it('refreshes a token only for the requested active tenant connection', async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const repository = {
      findConnection: vi.fn().mockResolvedValue({
        id: 'connection-a', tenantId: 'tenant-a', status: 'ACTIVE',
        encryptedRefreshToken: cipher.encrypt('refresh-a'), credentialGenerationId: 'generation-a',
      }),
      markReauthorizationRequired: vi.fn(),
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access-a' }), { status: 200 }));
    const provider = new GoogleOAuthTokenProvider(repository, cipher, { clientId: 'client', clientSecret: 'secret' }, fetchFn);

    await expect(provider.getAccessToken('connection-a', 'tenant-a')).resolves.toBe('access-a');

    expect(repository.findConnection).toHaveBeenCalledWith('connection-a', 'tenant-a');
    expect(fetchFn.mock.calls[0]?.[1]?.body?.toString()).toContain('refresh_token=refresh-a');
  });

  it('marks only the matching generation for reauthorization after a rejected refresh', async () => {
    const cipher = new CredentialCipher(Buffer.alloc(32, 7));
    const repository = {
      findConnection: vi.fn().mockResolvedValue({
        id: 'connection-a', tenantId: 'tenant-a', status: 'ACTIVE',
        encryptedRefreshToken: cipher.encrypt('refresh-a'), credentialGenerationId: 'generation-a',
      }),
      markReauthorizationRequired: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new GoogleOAuthTokenProvider(repository, cipher, { clientId: 'client', clientSecret: 'secret' }, vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(provider.getAccessToken('connection-a', 'tenant-a')).rejects.toMatchObject({ code: 'AUTHORIZATION' });
    expect(repository.markReauthorizationRequired).toHaveBeenCalledWith('tenant-a', 'generation-a');
  });

  it('rejects a missing or cross-tenant connection before contacting Google', async () => {
    const fetchFn = vi.fn();
    const provider = new GoogleOAuthTokenProvider(
      { findConnection: vi.fn().mockResolvedValue(null), markReauthorizationRequired: vi.fn() },
      new CredentialCipher(Buffer.alloc(32, 7)),
      { clientId: 'client', clientSecret: 'secret' },
      fetchFn,
    );

    await expect(provider.getAccessToken('connection-a', 'tenant-b')).rejects.toMatchObject({ code: 'AUTHORIZATION' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
