import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AuthPrincipal } from '@autosale/contracts/auth';
import { configureRuntimeDatabaseRoles, createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AccountDeleteReauthService } from './account-delete-reauth.service.js';
import { CryptoService } from './crypto.service.js';
import type { RateLimitService } from './rate-limit.service.js';

const password = 'Fictional current passphrase 123!';
const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';
const pepper = 'fictional-proof-pepper-at-least-32-chars';
const start = new Date(Date.now() + 60_000);

describe('account deletion local-password reauthentication', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let admin: PrismaClient;
  let api: PrismaClient;
  let crypto: CryptoService;
  let now: Date;
  const consumeRateLimit = vi.fn(async () => undefined);
  let service: AccountDeleteReauthService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    admin = createPrismaClient(container.getConnectionUri());
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    crypto = new CryptoService();
    now = start;
    service = new AccountDeleteReauthService(
      api, crypto, { consume: consumeRateLimit } as unknown as RateLimitService, pepper, () => now,
    );
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await admin?.$disconnect();
    await pool?.end();
    await container?.stop();
  });

  async function fixture(options?: { passwordHash?: string | null }): Promise<AuthPrincipal> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const sessionId = randomUUID();
    await admin.tenant.create({ data: { id: tenantId, key: `fictional-${tenantId}`, name: 'Fictional Shop' } });
    await admin.user.create({ data: {
      id: userId, email: `${userId}@example.invalid`, name: 'Fictional Owner',
      status: 'ACTIVE', passwordHash: options?.passwordHash === undefined ? await crypto.hashPassword(password) : options.passwordHash,
      emailVerifiedAt: start,
    } });
    await admin.tenant.update({ where: { id: tenantId }, data: { createdByUserId: userId } });
    await admin.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER', status: 'ACTIVE' } });
    await admin.session.create({ data: { id: sessionId, tenantId, userId, tokenHash: `fictional-${sessionId}`, expiresAt: new Date('2099-01-01T00:00:00Z') } });
    return {
      userId, sessionId, tenantId, email: `${userId}@example.invalid`, name: 'Fictional Owner',
      platformRole: 'USER', membershipRole: 'OWNER', locale: 'uk', avatarUrl: null,
    };
  }

  it('issues a five-minute purpose-bound proof and consumes it once', async () => {
    const principal = await fixture();
    const issued = await service.issueLocalPasswordProof(principal, password, '192.0.2.1');
    expect(issued.proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt).toEqual(new Date(start.getTime() + 5 * 60_000));
    expect(consumeRateLimit).toHaveBeenCalledWith('account-delete-reauth', '192.0.2.1', principal.email, 5, 900);

    const stored = await withTenantTransaction(api, principal.tenantId!, (tx) => tx.accountReauthProof.findFirst());
    expect(stored).toMatchObject({ userId: principal.userId, sessionId: principal.sessionId,
      tenantId: principal.tenantId, purpose: 'ACCOUNT_DELETE', method: 'LOCAL_PASSWORD', usedAt: null });
    expect(stored!.tokenHash).not.toBe(issued.proof);
    await withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, principal, issued.proof));
    await expect(withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, principal, issued.proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    await expect(withTenantTransaction(api, principal.tenantId!, (tx) => tx.accountReauthProof.update({
      where: { tokenHash: stored!.tokenHash }, data: { usedAt: null },
    }))).rejects.toThrow();
  });

  it('rejects consumption after database-clock expiry even when application time is stale', async () => {
    const principal = await fixture();
    const tokenHash = `fictional-expired-${randomUUID()}`;
    await admin.accountReauthProof.create({ data: {
      userId: principal.userId, tenantId: principal.tenantId!, sessionId: principal.sessionId,
      purpose: 'ACCOUNT_DELETE', method: 'LOCAL_PASSWORD', tokenHash,
      credentialFingerprint: 'fictional-fingerprint',
      expiresAt: new Date(Date.now() - 1_000),
    } });
    now = new Date(Date.now() - 60_000);
    await expect(withTenantTransaction(api, principal.tenantId!, (tx) => tx.accountReauthProof.updateMany({
      where: { tokenHash, usedAt: null }, data: { usedAt: now },
    }))).rejects.toThrow('ACCOUNT_REAUTH_PROOF_IMMUTABLE');
    now = start;
  });

  it('allows only one of two concurrent consumers to use a proof', async () => {
    const principal = await fixture();
    const { proof } = await service.issueLocalPasswordProof(principal, password, '192.0.2.1');
    const results = await Promise.allSettled([
      withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, principal, proof)),
      withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, principal, proof)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects a wrong password without storing a proof', async () => {
    const principal = await fixture();
    await expect(service.issueLocalPasswordProof(principal, 'wrong password', '192.0.2.1'))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    expect(await admin.accountReauthProof.count({ where: { userId: principal.userId } })).toBe(0);
  });

  it('rechecks the verified password hash and active session under lock before issuing', async () => {
    const changed = await fixture();
    const raceCrypto = {
      verifyPassword: async (hash: string, supplied: string) => {
        const valid = await crypto.verifyPassword(hash, supplied);
        await admin.user.update({ where: { id: changed.userId }, data: {
          passwordHash: await crypto.hashPassword('Fictional changed during check 789!'),
        } });
        return valid;
      },
      issueOpaqueToken: crypto.issueOpaqueToken.bind(crypto),
      hashOpaqueToken: crypto.hashOpaqueToken.bind(crypto),
    } as CryptoService;
    const racingService = new AccountDeleteReauthService(
      api, raceCrypto, { consume: consumeRateLimit } as unknown as RateLimitService, pepper, () => now,
    );
    await expect(racingService.issueLocalPasswordProof(changed, password, '192.0.2.1'))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    expect(await admin.accountReauthProof.count({ where: { userId: changed.userId } })).toBe(0);

    const loggedOut = await fixture();
    const logoutCrypto = {
      verifyPassword: async (hash: string, supplied: string) => {
        const valid = await crypto.verifyPassword(hash, supplied);
        await admin.session.update({ where: { id: loggedOut.sessionId }, data: { revokedAt: now } });
        return valid;
      },
      issueOpaqueToken: crypto.issueOpaqueToken.bind(crypto),
      hashOpaqueToken: crypto.hashOpaqueToken.bind(crypto),
    } as CryptoService;
    const loggedOutService = new AccountDeleteReauthService(
      api, logoutCrypto, { consume: consumeRateLimit } as unknown as RateLimitService, pepper, () => now,
    );
    await expect(loggedOutService.issueLocalPasswordProof(loggedOut, password, '192.0.2.1'))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    expect(await admin.accountReauthProof.count({ where: { userId: loggedOut.userId } })).toBe(0);
  });

  it('rejects Google-only accounts until a dedicated OAuth reauthentication exists', async () => {
    const principal = await fixture({ passwordHash: null });
    await expect(service.issueLocalPasswordProof(principal, password, '192.0.2.1'))
      .rejects.toThrow('ACCOUNT_DELETE_LOCAL_PASSWORD_UNAVAILABLE');
  });

  it('rejects a proof after password change, logout, or expiry', async () => {
    const changed = await fixture();
    const changedProof = await service.issueLocalPasswordProof(changed, password, '192.0.2.1');
    await admin.user.update({ where: { id: changed.userId }, data: { passwordHash: await crypto.hashPassword('Fictional replacement 456!') } });
    await expect(withTenantTransaction(api, changed.tenantId!, (tx) => service.consumeInTransaction(tx, changed, changedProof.proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');

    const loggedOut = await fixture();
    const loggedOutProof = await service.issueLocalPasswordProof(loggedOut, password, '192.0.2.1');
    await admin.session.update({ where: { id: loggedOut.sessionId }, data: { revokedAt: now } });
    await expect(withTenantTransaction(api, loggedOut.tenantId!, (tx) => service.consumeInTransaction(tx, loggedOut, loggedOutProof.proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');

    const expired = await fixture();
    const expiredProof = await service.issueLocalPasswordProof(expired, password, '192.0.2.1');
    now = new Date(start.getTime() + 5 * 60_000);
    await expect(withTenantTransaction(api, expired.tenantId!, (tx) => service.consumeInTransaction(tx, expired, expiredProof.proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    now = start;
  });

  it('rejects cross-session and non-founder use of a proof', async () => {
    const principal = await fixture();
    const { proof } = await service.issueLocalPasswordProof(principal, password, '192.0.2.1');
    const otherSession = randomUUID();
    await admin.session.create({ data: { id: otherSession, userId: principal.userId, tenantId: principal.tenantId, tokenHash: `fictional-${otherSession}`, expiresAt: new Date('2099-01-01T00:00:00Z') } });
    await expect(withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, { ...principal, sessionId: otherSession }, proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
    await admin.tenant.update({ where: { id: principal.tenantId! }, data: { createdByUserId: null } });
    await expect(withTenantTransaction(api, principal.tenantId!, (tx) => service.consumeInTransaction(tx, principal, proof)))
      .rejects.toThrow('ACCOUNT_DELETE_REAUTH_INVALID');
  });
});

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const directory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
  const migrations = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const migration of migrations) await pool.query(await readFile(resolve(directory, migration, 'migration.sql'), 'utf8'));
}

function runtimeUrl(connectionString: string, user: string, passwordValue: string): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = passwordValue;
  return url.toString();
}
