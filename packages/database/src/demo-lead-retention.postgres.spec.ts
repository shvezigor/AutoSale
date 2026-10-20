import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { DemoLeadNotificationStore } from './demo-lead-notifications.js';
import { DemoLeadRetentionStore } from './demo-lead-retention.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';

const now = new Date('2027-04-18T00:00:00.000Z');
const day = 86_400_000;
const daysBefore = (count: number) => new Date(now.getTime() - count * day);

describe('demo lead contact retention with PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let owner: ReturnType<typeof createPrismaClient>;
  let worker: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), 'prisma/migrations');
    for (const entry of (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
      await pool.query(await readFile(resolve(root, entry, 'migration.sql'), 'utf8'));
    }
    owner = createPrismaClient(container.getConnectionUri());
    const passwords = { apiPassword: 'fictional-api-password-32-characters', workerPassword: 'fictional-worker-password-32-chars', backupPassword: 'fictional-backup-password-32-chars' };
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    const workerUrl = new URL(container.getConnectionUri());
    workerUrl.username = 'autosale_worker'; workerUrl.password = passwords.workerPassword;
    worker = createPrismaClient(workerUrl.toString());
  }, 90_000);

  afterAll(async () => { await worker?.$disconnect(); await owner?.$disconnect(); await pool?.end(); await container?.stop(); });
  beforeEach(async () => { await owner.demoLead.deleteMany(); });

  async function lead(createdAt: Date, extra: Record<string, unknown> = {}) {
    return owner.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Lead', company: 'Fictional Store',
      email: 'fictional@example.test', orderVolume: 'UNDER_50', locale: 'en', createdAt, ...extra,
    } });
  }

  it('uses the exact 180-day deadline, while reads and notification state do not extend it', async () => {
    const row = await lead(daysBefore(180));
    const store = new DemoLeadRetentionStore(worker);
    expect(await store.purgeDue(new Date(now.getTime() - 1), 100)).toEqual({ purged: 0, busy: 0 });
    await owner.demoLead.findUniqueOrThrow({ where: { id: row.id } });
    await owner.demoLead.update({ where: { id: row.id }, data: { notificationStatus: 'SENT', notifiedAt: new Date(now.getTime() - 1) } });
    expect(await store.purgeDue(now, 100)).toEqual({ purged: 1, busy: 0 });
    expect(await owner.demoLead.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await new DemoLeadNotificationStore(worker, () => now).claim(row.id)).toBeNull();
    expect(await store.purgeDue(now, 100)).toEqual({ purged: 0, busy: 0 });
    const audit = await owner.securityAuditLog.findFirst({ where: { action: 'DEMO_LEAD_RETENTION_PURGED' }, orderBy: { createdAt: 'desc' } });
    expect(audit).toMatchObject({ userId: null, actor: 'SYSTEM', metadata: { leadId: row.id, reason: 'RETENTION' } });
    expect(JSON.stringify(audit)).not.toContain('fictional@example.test');
  });

  it('extends only after a status action but obeys the absolute 365-day cap', async () => {
    const extended = await lead(daysBefore(200), { lastOperatorActionAt: daysBefore(1) });
    const capped = await lead(daysBefore(365), { lastOperatorActionAt: daysBefore(1) });
    const store = new DemoLeadRetentionStore(worker);
    expect(await store.purgeDue(now, 100)).toEqual({ purged: 1, busy: 0 });
    expect(await owner.demoLead.findUnique({ where: { id: extended.id } })).not.toBeNull();
    expect(await owner.demoLead.findUnique({ where: { id: capped.id } })).toBeNull();
  });

  it('refuses active leases but permits an expired lease and remains idempotent', async () => {
    const active = await lead(daysBefore(180), { notificationLeaseId: randomUUID(), notificationLeaseExpiresAt: new Date(now.getTime() + day) });
    const expired = await lead(daysBefore(180), { notificationLeaseId: randomUUID(), notificationLeaseExpiresAt: new Date(now.getTime() - 1) });
    const store = new DemoLeadRetentionStore(worker);
    expect(await store.purgeDue(now, 100)).toEqual({ purged: 1, busy: 1 });
    expect(await owner.demoLead.findUnique({ where: { id: active.id } })).not.toBeNull();
    expect(await owner.demoLead.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await store.purgeDue(now, 100)).toEqual({ purged: 0, busy: 1 });
  });

  it('skips a row locked by an in-flight claim and can purge it after that transaction ends', async () => {
    const row = await lead(daysBefore(180));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM demo_leads WHERE id = $1 FOR UPDATE', [row.id]);
      const store = new DemoLeadRetentionStore(worker);
      expect(await store.purgeDue(now, 100)).toEqual({ purged: 0, busy: 0 });
      await client.query('COMMIT');
      expect(await store.purgeDue(now, 100)).toEqual({ purged: 1, busy: 0 });
    } finally { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  });
});
