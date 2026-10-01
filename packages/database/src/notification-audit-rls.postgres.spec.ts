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
const platformAdmin = '55555555-5555-4555-8555-555555555555';

describe('notification and security audit row-level security', () => {
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

  it('fails closed without tenant context and exposes only selected-tenant rows', async () => {
    for (const client of [api, worker]) {
      await expect(client.userNotification.findMany()).resolves.toEqual([]);
      await expect(client.securityAuditLog.findMany()).resolves.toEqual([]);
    }

    await expect(withTenantTransaction(api, tenantA, async (tx) => ({
      notifications: await tx.userNotification.count(),
      audits: await tx.securityAuditLog.count(),
    }))).resolves.toEqual({ notifications: 1, audits: 1 });
  });

  it('rejects cross-tenant notification and audit writes', async () => {
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.userNotification.updateMany({
      where: { tenantId: tenantB }, data: { readAt: new Date() },
    }))).resolves.toEqual({ count: 0 });
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.securityAuditLog.updateMany({
      where: { tenantId: tenantB }, data: { result: 'FAILURE' },
    }))).resolves.toEqual({ count: 0 });
  });

  it('gives only the worker a bounded notification-retention directory', async () => {
    const cutoff = new Date('2026-10-01T00:00:00Z');
    await expect(worker.$queryRaw`
      SELECT tenant_id, notification_id
      FROM public.worker_expired_user_notifications(${cutoff}, ${1})
    `).resolves.toEqual([{ tenant_id: tenantA, notification_id: expect.any(String) }]);
    await expect(api.$queryRaw`
      SELECT * FROM public.worker_expired_user_notifications(${cutoff}, ${1000})
    `).rejects.toMatchObject({ code: 'P2010' });
  });

  it('allows tenantless audit append only for an active platform administrator', async () => {
    await expect(api.$queryRaw`
      SELECT audit_id FROM public.api_append_platform_security_audit_log(
        ${platformAdmin}::uuid, ${'USER'}, ${'PLATFORM_PROFILE_UPDATED'}, ${'SUCCESS'}, ${JSON.stringify({ source: 'test' })}::jsonb
      )
    `).resolves.toEqual([{ audit_id: expect.any(String) }]);
    await expect(api.$queryRaw`
      SELECT audit_id FROM public.api_append_platform_security_audit_log(
        ${userA}::uuid, ${'USER'}, ${'PLATFORM_PROFILE_UPDATED'}, ${'SUCCESS'}, ${JSON.stringify({ source: 'test' })}::jsonb
      )
    `).resolves.toEqual([]);
    await expect(worker.$queryRaw`
      SELECT * FROM public.api_append_platform_security_audit_log(
        ${platformAdmin}::uuid, ${'USER'}, ${'PLATFORM_PROFILE_UPDATED'}, ${'SUCCESS'}, ${JSON.stringify({ source: 'test' })}::jsonb
      )
    `).rejects.toMatchObject({ code: 'P2010' });
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
    await prisma.userNotification.create({ data: {
      tenantId, userId, type: 'INFO', category: 'FICTIONAL', title: `Fictional ${suffix}`,
      createdAt: new Date(`2026-01-0${suffix === 'a' ? '1' : '2'}T00:00:00Z`),
    } });
    await prisma.securityAuditLog.create({ data: {
      tenantId, userId, actor: 'USER', action: 'FICTIONAL_EVENT', result: 'SUCCESS', metadata: {},
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
