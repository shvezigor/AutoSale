import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { configureRuntimeDatabaseRoles, createPrismaClient } from '@autosale/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdminDemoLeadsService } from './admin-demo-leads.service.js';

const adminId = '11111111-1111-4111-8111-111111111111';
const rolePasswords = {
  apiPassword: 'fictional-api-password-32-characters',
  workerPassword: 'fictional-worker-password-32-chars',
  backupPassword: 'fictional-backup-password-32-chars',
};

describe('AdminDemoLeadsService PostgreSQL audit boundary', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let owner: ReturnType<typeof createPrismaClient>;
  let api: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrations = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const entry of (await readdir(migrations, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
      await pool.query(await readFile(resolve(migrations, entry, 'migration.sql'), 'utf8'));
    }
    owner = createPrismaClient(container.getConnectionUri());
    await owner.user.create({ data: { id: adminId, email: 'admin@example.test', name: 'Fictional Admin', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN', emailVerifiedAt: new Date() } });
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), rolePasswords);
    const apiUrl = new URL(container.getConnectionUri());
    apiUrl.username = 'autosale_api';
    apiUrl.password = rolePasswords.apiPassword;
    api = createPrismaClient(apiUrl.toString());
  }, 90_000);

  afterAll(async () => {
    await api?.$disconnect();
    await owner?.$disconnect();
    await pool?.end();
    await container?.stop();
  });

  it('commits a versioned status and minimal audit but rolls back when audit fails', async () => {
    const lead = await owner.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Olena', company: 'Fictional Shop',
      email: 'olena@example.test', orderVolume: 'UNDER_50', locale: 'en',
    } });
    const service = new AdminDemoLeadsService(api);
    const listing = await service.list({ status: 'NEW' });
    expect(listing.items.find((item) => item.id === lead.id)?.maskedContact).toBe('o***@***');
    expect(JSON.stringify(listing)).not.toContain('olena@example.test');

    await expect(service.changeStatus(lead.id, 'CONTACTED', 0, adminId)).resolves.toEqual({ id: lead.id, status: 'CONTACTED', version: 1 });
    const changed = await owner.demoLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(changed).toMatchObject({ lifecycleStatus: 'CONTACTED', version: 1, lastOperatorActionAt: expect.any(Date) });
    const audits = await owner.securityAuditLog.findMany({ where: { action: 'DEMO_LEAD_STATUS_CHANGED' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toEqual({ leadId: lead.id, from: 'NEW', to: 'CONTACTED' });
    expect(JSON.stringify(audits)).not.toContain('olena@example.test');

    const failing = new AdminDemoLeadsService(api, async () => { throw new Error('fictional audit failure'); });
    await expect(failing.changeStatus(lead.id, 'QUALIFIED', 1, adminId)).rejects.toThrow('fictional audit failure');
    await expect(owner.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).resolves.toMatchObject({ lifecycleStatus: 'CONTACTED', version: 1 });
  });

  it('pages equal-timestamp leads without duplicates', async () => {
    const createdAt = new Date('2026-10-20T10:00:00.000Z');
    const ids: string[] = [];
    for (const index of [1, 2]) {
      const lead = await owner.demoLead.create({ data: {
        idempotencyKey: randomUUID(), name: `Fictional Lead ${index}`, company: `Fictional Shop ${index}`,
        email: `lead${index}@example.test`, orderVolume: 'UNDER_50', locale: 'en', createdAt,
      } });
      ids.push(lead.id);
    }
    const service = new AdminDemoLeadsService(api);
    const first = await service.list({ status: 'NEW', limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0]?.id);
    const second = await service.list({ status: 'NEW', limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(new Set([first.items[0]?.id, second.items[0]?.id])).toEqual(new Set(ids));
  });
});
