import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { DemoLeadNotificationStore } from './demo-lead-notifications.js';

const now = new Date('2026-10-15T12:00:00Z');

describe('DemoLeadNotificationStore', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
    for (const entry of (await readdir(root, { withFileTypes: true }))
      .filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
      await pool.query(await readFile(resolve(root, entry, 'migration.sql'), 'utf8'));
    }
    prisma = createPrismaClient(container.getConnectionUri());
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.demoLead.deleteMany();
  });

  it('allows only one concurrent lease for a due lead and never reclaims SENT', async () => {
    const lead = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Lead', company: 'Example Store',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(now.getTime() - 1_000),
    } });
    const store = new DemoLeadNotificationStore(prisma, () => now);

    const claims = await Promise.all([store.claim(lead.id), store.claim(lead.id)]);
    const claimed = claims.filter((claim) => claim !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: lead.id, attempt: 1, email: 'lead@example.test' });
    expect(claimed[0]!.leaseId).toMatch(/^[0-9a-f-]{36}$/);

    expect(await store.markSent(lead.id, claimed[0]!.leaseId)).toBe(true);
    expect(await store.claim(lead.id)).toBeNull();
    const persisted = await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(persisted).toMatchObject({ notificationStatus: 'SENT', notificationAttempts: 1,
      notificationLeaseId: null, notificationNextAttemptAt: null });
  });

  it('schedules three bounded retry delays and stops after the fourth failed attempt', async () => {
    const lead = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Lead', company: 'Example Store',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(now.getTime() - 1_000),
    } });
    let clock = now;
    const store = new DemoLeadNotificationStore(prisma, () => clock);
    for (const [attempt, delay] of [[1, 60_000], [2, 300_000], [3, 900_000], [4, null]] as const) {
      const claim = await store.claim(lead.id);
      expect(claim?.attempt).toBe(attempt);
      const due = await store.markFailed(lead.id, claim!.leaseId, 'DELIVERY_FAILED', false);
      expect(due?.getTime() ?? null).toBe(delay === null ? null : clock.getTime() + delay);
      const saved = await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(saved.notificationStatus).toBe('FAILED');
      expect(saved.notificationAttempts).toBe(attempt);
      expect(saved.notificationLeaseId).toBeNull();
      if (due) clock = due;
    }
    expect(await store.claim(lead.id)).toBeNull();
    expect(await store.counts()).toEqual({ due: 0, exhausted: 1 });
  });

  it('lists only due leads and recovers an expired lease without exposing contact fields', async () => {
    const due = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Due', company: 'Example Store',
      email: 'due@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(now.getTime() - 1_000),
    } });
    const future = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Future', company: 'Example Store',
      email: 'future@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(now.getTime() + 600_000),
    } });
    let clock = now;
    const store = new DemoLeadNotificationStore(prisma, () => clock);
    expect(await store.listDue(50)).toEqual([due.id]);
    const first = await store.claim(due.id);
    expect(await store.listDue(50)).toEqual([]);
    clock = new Date(now.getTime() + 121_000);
    expect(await store.listDue(50)).toContain(due.id);
    const second = await store.claim(due.id);
    expect(second?.attempt).toBe(2);
    expect(await store.markSent(due.id, first!.leaseId)).toBe(false);
    expect(await store.markSent(due.id, second!.leaseId)).toBe(true);
    expect(await store.listDue(50)).not.toContain(due.id);
    expect(await store.listDue(50)).not.toContain(future.id);
  });

  it('marks an abandoned fourth attempt terminal instead of leaving it pending forever', async () => {
    const lead = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Lead', company: 'Example Store',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationStatus: 'FAILED', notificationAttempts: 3,
      notificationNextAttemptAt: new Date(now.getTime() - 1_000),
    } });
    let clock = now;
    const store = new DemoLeadNotificationStore(prisma, () => clock);
    expect((await store.claim(lead.id))?.attempt).toBe(4);
    clock = new Date(now.getTime() + 121_000);

    expect(await store.finalizeExpiredLeases()).toBe(1);
    const saved = await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(saved).toMatchObject({ notificationStatus: 'FAILED', notificationAttempts: 4,
      notificationNextAttemptAt: null, notificationLeaseId: null,
      lastNotificationError: 'DELIVERY_UNKNOWN' });
    expect(await store.listDue(50)).toEqual([]);
    expect(await store.counts()).toEqual({ due: 0, exhausted: 1 });
  });
});
