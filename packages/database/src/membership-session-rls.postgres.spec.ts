import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';
import { withTenantTransaction } from './tenant-transaction.js';

const apiPassword = 'fictional-api-password-32-characters';
const workerPassword = 'fictional-worker-password-32-chars';
const backupPassword = 'fictional-backup-password-32-chars';
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';
const sessionA = '55555555-5555-4555-8555-555555555555';
const platformAdmin = '66666666-6666-4666-8666-666666666666';

describe('membership, invitation and session row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let admin: PrismaClient;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    adminPool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(adminPool);
    admin = createPrismaClient(container.getConnectionUri());
    await seed(admin);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    api = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
    worker = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_worker', workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.$disconnect();
    await adminPool?.end();
    await container?.stop();
  });

  it('fails closed without tenant context and exposes only the selected tenant records', async () => {
    for (const client of [api, worker]) {
      await expect(client.tenantMembership.findMany()).resolves.toEqual([]);
      await expect(client.tenantInvitation.findMany()).resolves.toEqual([]);
      await expect(client.session.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      memberships: await tx.tenantMembership.count(),
      invitations: await tx.tenantInvitation.count(),
      sessions: await tx.session.count(),
    }))).resolves.toEqual({ memberships: 1, invitations: 1, sessions: 1 });
  });

  it('rejects cross-tenant membership, invitation and session writes', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.tenantMembership.updateMany({
      where: { tenantId: tenantB }, data: { status: 'BLOCKED' },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.tenantInvitation.updateMany({
      where: { tenantId: tenantB }, data: { revokedAt: new Date() },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.session.updateMany({
      where: { tenantId: tenantB }, data: { revokedAt: new Date() },
    }))).resolves.toEqual({ count: 0 });
  });

  it('allows only the API role to resolve authentication routing authority', async () => {
    await expect(api.$queryRaw`
      SELECT tenant_id, membership_role FROM public.api_active_membership_for_user(${userA}::uuid)
    `).resolves.toEqual([{ tenant_id: tenantA, membership_role: 'OWNER' }]);
    await expect(api.$queryRaw`
      SELECT tenant_id, invitation_id FROM public.api_invitation_authority(${'invitation-hash-a'}, ${new Date('2026-10-01T12:00:00Z')})
    `).resolves.toEqual([{ tenant_id: tenantA, invitation_id: expect.any(String) }]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_active_membership_for_user(${userA}::uuid)
    `).rejects.toMatchObject({ code: 'P2010' });
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_invitation_authority(${'invitation-hash-a'}, ${new Date('2026-10-01T12:00:00Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('issues, resolves and revokes sessions only through API authority functions', async () => {
    const issued = await api.$queryRaw<Array<{ session_id: string }>>`
      SELECT session_id FROM public.api_issue_session(
        ${sessionA}::uuid, ${userA}::uuid, ${tenantA}::uuid, ${'new-token-hash'},
        ${new Date('2026-11-01T00:00:00Z')}, ${'127.0.0.1'}, ${'fictional-agent'}
      )
    `;
    expect(issued).toEqual([{ session_id: sessionA }]);

    await expect(api.$queryRaw`
      SELECT session_id, user_id, tenant_id, membership_role
      FROM public.api_resolve_session(${'new-token-hash'}, ${new Date('2026-10-01T12:00:00Z')})
    `).resolves.toEqual([{ session_id: sessionA, user_id: userA, tenant_id: tenantA, membership_role: 'OWNER' }]);
    await expect(api.$queryRaw`
      SELECT revoked_count FROM public.api_revoke_sessions(${userA}::uuid, ${sessionA}::uuid, NULL::uuid, ${new Date('2026-10-01T12:01:00Z')})
    `).resolves.toEqual([{ revoked_count: 1 }]);
    await expect(api.$queryRaw`
      SELECT revoked_count FROM public.api_revoke_session(${sessionA}::uuid, ${new Date('2026-10-01T12:01:30Z')})
    `).resolves.toEqual([{ revoked_count: 1 }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.api_resolve_session(${'new-token-hash'}, ${new Date('2026-10-01T12:02:00Z')})
    `).resolves.toEqual([]);

    await expect(worker.$queryRaw`
      SELECT * FROM public.api_resolve_session(${'session-hash-a'}, ${new Date('2026-10-01T12:00:00Z')})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('refuses an unbounded session revocation request', async () => {
    await expect(api.$queryRaw`
      SELECT revoked_count FROM public.api_revoke_sessions(
        NULL::uuid, NULL::uuid, NULL::uuid, ${new Date('2026-10-01T12:00:00Z')}
      )
    `).resolves.toEqual([{ revoked_count: 0 }]);
  });

  it('allows tenantless sessions only for an active platform administrator', async () => {
    await expect(api.$queryRaw`
      SELECT session_id FROM public.api_issue_session(
        ${'77777777-7777-4777-8777-777777777777'}::uuid, ${userA}::uuid, NULL::uuid,
        ${'regular-tenantless-hash'}, ${new Date('2026-11-01T00:00:00Z')}, NULL, NULL
      )
    `).resolves.toEqual([]);
    await expect(api.$queryRaw`
      SELECT session_id FROM public.api_issue_session(
        ${'88888888-8888-4888-8888-888888888888'}::uuid, ${platformAdmin}::uuid, NULL::uuid,
        ${'admin-tenantless-hash'}, ${new Date('2026-11-01T00:00:00Z')}, NULL, NULL
      )
    `).resolves.toEqual([{ session_id: '88888888-8888-4888-8888-888888888888' }]);
  });
});

async function seed(prisma: PrismaClient): Promise<void> {
  for (const [tenantId, userId, suffix] of [[tenantA, userA, 'a'], [tenantB, userB, 'b']] as const) {
    await prisma.tenant.create({ data: { id: tenantId, key: `fictional-${suffix}`, name: `Fictional ${suffix}` } });
    await prisma.user.create({ data: {
      id: userId, email: `${suffix}@example.invalid`, name: `Fictional ${suffix}`,
      status: 'ACTIVE', emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    } });
    await prisma.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.tenantInvitation.create({ data: {
      tenantId, invitedById: userId, email: `manager-${suffix}@example.invalid`,
      tokenHash: `invitation-hash-${suffix}`, expiresAt: new Date('2099-01-01T00:00:00Z'),
    } });
    await prisma.session.create({ data: {
      userId, tenantId, tokenHash: `session-hash-${suffix}`, expiresAt: new Date('2099-01-01T00:00:00Z'),
    } });
  }
  await prisma.user.create({ data: {
    id: platformAdmin, email: 'admin@example.invalid', name: 'Fictional Admin',
    platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  } });
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const directory = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  const migrations = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(directory, migration, 'migration.sql'), 'utf8'));
  }
}

function runtimeUrl(connectionString: string, user: string, password: string): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = password;
  return url.toString();
}
