import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, TikTokBusinessMessagingError } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TikTokTokenService } from './tiktok-token.service.js';

describe('TikTokTokenService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  let generationId: string;
  const cipher = new CredentialCipher(Buffer.alloc(32, 7));
  const refreshToken = vi.fn();
  const now = new Date('2026-10-04T08:00:00.000Z');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationsRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const pool = new pg.Pool({ connectionString });
    for (const migrationPath of (await readdir(migrationsRoot)).filter((name) => name !== 'migration_lock.toml').sort()) {
      await pool.query(await readFile(resolve(migrationsRoot, migrationPath, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  beforeEach(async () => {
    await prisma.tenant.deleteMany();
    tenantId = (await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional TikTok Shop' } })).id;
    generationId = randomUUID();
    refreshToken.mockReset().mockResolvedValue({
      accessToken: 'rotated-access', refreshToken: 'rotated-refresh', accountId: 'fictional-business',
      grantedScopes: ['message.list.read', 'message.list.manage'], expiresIn: 86_400, refreshTokenExpiresIn: 2_592_000,
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('reuses a token that is not near expiry', async () => {
    await seed(new Date(now.getTime() + 10 * 60_000));
    const service = createService();
    await expect(service.getFreshAccessToken(tenantId, generationId, now)).resolves.toBe('current-access');
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes a near-expiry token only once under concurrency and stores both encrypted tokens', async () => {
    await seed(new Date(now.getTime() + 60_000));
    const service = createService();
    const results = await Promise.all([
      service.getFreshAccessToken(tenantId, generationId, now),
      service.getFreshAccessToken(tenantId, generationId, now),
    ]);
    expect(results).toEqual(['rotated-access', 'rotated-access']);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    const row = await prisma.tikTokConnection.findUniqueOrThrow({ where: { tenantId } });
    expect(cipher.decrypt(row.encryptedAccessToken!)).toBe('rotated-access');
    expect(cipher.decrypt(row.encryptedRefreshToken!)).toBe('rotated-refresh');
    expect(row.refreshLeaseId).toBeNull();
  });

  it('cannot update a superseded credential generation', async () => {
    await seed(new Date(now.getTime() + 60_000));
    const service = createService();
    await expect(service.getFreshAccessToken(tenantId, randomUUID(), now)).rejects.toThrow('TikTok credentials unavailable');
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('marks permanent refresh rejection as requiring reauthorization', async () => {
    await seed(new Date(now.getTime() + 60_000));
    refreshToken.mockRejectedValue(new TikTokBusinessMessagingError('TOKEN_REFRESH', 400, 40001, 'fictional-request', false));
    await expect(createService().getFreshAccessToken(tenantId, generationId, now)).rejects.toThrow('TikTok token refresh failed');
    await expect(prisma.tikTokConnection.findUniqueOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      status: 'REAUTH_REQUIRED', lastErrorCode: 'TIKTOK_TOKEN_REFRESH_REJECTED', refreshLeaseId: null,
    });
  });

  async function seed(tokenExpiresAt: Date): Promise<void> {
    await prisma.tikTokConnection.create({ data: {
      tenantId, externalAccountId: 'fictional-business', status: 'INBOUND_ONLY',
      encryptedAccessToken: cipher.encrypt('current-access'), encryptedRefreshToken: cipher.encrypt('current-refresh'),
      credentialGenerationId: generationId, tokenExpiresAt,
      refreshTokenExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    } });
  }

  function createService(): TikTokTokenService {
    return new TikTokTokenService(prisma, { refreshToken } as never, cipher, async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
    });
  }
});
