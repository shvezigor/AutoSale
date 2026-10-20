import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';
import { withTenantTransaction } from './tenant-transaction.js';

describe('privacy-minimal marketing counters', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let owner: ReturnType<typeof createPrismaClient>;
  let api: ReturnType<typeof createPrismaClient>;
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
    const apiUrl = new URL(container.getConnectionUri());
    apiUrl.username = 'autosale_api'; apiUrl.password = passwords.apiPassword;
    api = createPrismaClient(apiUrl.toString());
    const workerUrl = new URL(container.getConnectionUri());
    workerUrl.username = 'autosale_worker'; workerUrl.password = passwords.workerPassword;
    worker = createPrismaClient(workerUrl.toString());
  }, 90_000);

  afterAll(async () => { await worker?.$disconnect(); await api?.$disconnect(); await owner?.$disconnect(); await pool?.end(); await container?.stop(); });

  it('atomically increments only fixed anonymous cells and denies raw API-role reads', async () => {
    for (let index = 0; index < 2; index += 1) {
      await api.$queryRaw`SELECT public.api_increment_marketing_counter(${'pricing_view'}, ${'uk'}, ${'none'})`;
    }
    expect(await owner.marketingDailyCounter.findMany()).toMatchObject([{ event: 'pricing_view', locale: 'uk', planId: 'none', count: 2 }]);
    await expect(api.marketingDailyCounter.findMany()).rejects.toThrow();
    await expect(api.$queryRaw`SELECT public.api_increment_marketing_counter(${'demo_intent'}, ${'uk'}, ${'none'})`).rejects.toThrow();
    expect(await owner.marketingDailyCounter.count()).toBe(1);
  });

  it('derives demo intent only from accepted lead rows, not from button clicks or a duplicate key', async () => {
    await owner.demoLead.create({ data: {
      idempotencyKey: 'fictional-demo-conversion-key', name: 'Fictional Contact', company: 'Fictional Shop',
      email: 'fictional@example.test', orderVolume: 'UNDER_50', locale: 'uk', createdAt: new Date('2026-10-20T08:00:00Z'),
    } });
    await expect(owner.demoLead.create({ data: {
      idempotencyKey: 'fictional-demo-conversion-key', name: 'Second Contact', company: 'Other Fictional Shop',
      email: 'other@example.test', orderVolume: 'UNDER_50', locale: 'uk', createdAt: new Date('2026-10-20T09:00:00Z'),
    } })).rejects.toThrow();
    const rows = await api.$queryRaw<Array<{ metric: string; total: bigint }>>`
      SELECT metric, total FROM public.platform_conversion_rollup(${'2026-10-20'}::date, ${'2026-10-20'}::date)
    `;
    expect(rows.find((row) => row.metric === 'demo_intent')?.total).toBe(1n);
  });

  it('isolates short-lived plan interests by current tenant context', async () => {
    const tenantA = '11111111-1111-4111-8111-111111111111';
    const tenantB = '22222222-2222-4222-8222-222222222222';
    await owner.tenant.createMany({ data: [
      { id: tenantA, key: 'fictional-a', name: 'Fictional Tenant A' },
      { id: tenantB, key: 'fictional-b', name: 'Fictional Tenant B' },
    ] });
    const day = new Date('2026-10-20T00:00:00Z');
    await withTenantTransaction(api, tenantA, (tx) => tx.tenantPlanInterest.create({ data: { tenantId: tenantA, planId: 'growth', day, createdAt: new Date('2026-10-20T09:00:00Z') } }));
    expect(await api.tenantPlanInterest.findMany()).toEqual([]);
    expect(await withTenantTransaction(api, tenantA, (tx) => tx.tenantPlanInterest.findMany({ select: { tenantId: true } })))
      .toEqual([{ tenantId: tenantA }]);
    expect(await withTenantTransaction(api, tenantB, (tx) => tx.tenantPlanInterest.findMany())).toEqual([]);
    await expect(withTenantTransaction(api, tenantB, (tx) => tx.tenantPlanInterest.create({
      data: { tenantId: tenantA, planId: 'scale', day },
    }))).rejects.toThrow();
  });

  it('derives one first real approved order per tenant, excluding demo conversations', async () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    await pool.query(`
      INSERT INTO conversations (id, tenant_id, channel, external_conversation_id, participant_id, last_message_at, updated_at)
      VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${tenantId}', 'INSTAGRAM', 'demo-client-fictional', 'fictional-demo', now(), now()),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${tenantId}', 'INSTAGRAM', 'fictional-real', 'fictional-real', now(), now());
      INSERT INTO messages (id, tenant_id, conversation_id, channel, external_message_id, direction, sender_id, text, source_timestamp, client_idempotency_key)
      VALUES
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${tenantId}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INSTAGRAM', 'fictional-demo-msg', 'OUTBOUND', 'fictional-manager', 'Demo', now(), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${tenantId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'INSTAGRAM', 'fictional-real-msg-1', 'OUTBOUND', 'fictional-manager', 'First', now(), 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${tenantId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'INSTAGRAM', 'fictional-real-msg-2', 'OUTBOUND', 'fictional-manager', 'Second', now(), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
      INSERT INTO orders (id, tenant_id, conversation_id, trigger_message_id, status, prompt_version, approved_at, updated_at)
      VALUES
        ('11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${tenantId}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'APPROVED', 'fictional-v1', '2026-10-19T10:00:00Z', now()),
        ('22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${tenantId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'APPROVED', 'fictional-v1', '2026-10-20T23:00:00Z', now()),
        ('33333333-cccc-4ccc-8ccc-cccccccccccc', '${tenantId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'AUTO_APPROVED', 'fictional-v1', '2026-10-20T23:30:00Z', now());
    `);
    const rows = await api.$queryRaw<Array<{ metric: string; total: bigint }>>`
      SELECT metric, total FROM public.platform_conversion_rollup(${'2026-10-20'}::date, ${'2026-10-20'}::date)
    `;
    expect(rows.find((row) => row.metric === 'first_order_confirmed')?.total).toBe(1n);
    expect(rows.find((row) => row.metric === 'tenant_plan_interest')?.total).toBe(1n);
    expect(rows.find((row) => row.metric === 'first_order_cohort_plan_interest')?.total).toBe(0n);
    await expect(api.$queryRaw`SELECT * FROM public.platform_conversion_rollup(${'2026-01-01'}::date, ${'2026-10-20'}::date)`)
      .rejects.toThrow();
  });

  it('purges only expired rows through the worker role and denies API execution', async () => {
    const now = new Date('2026-10-20T00:00:00Z');
    await owner.tenantPlanInterest.create({ data: {
      tenantId: '22222222-2222-4222-8222-222222222222', planId: 'start',
      day: new Date('2026-06-01T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z'),
    } });
    await owner.marketingDailyCounter.create({ data: {
      day: new Date('2025-08-01T00:00:00Z'), event: 'pricing_view', locale: 'en', planId: 'none', count: 2,
    } });
    const rows = await worker.$queryRaw<Array<{ interests_deleted: number; counters_deleted: number }>>`
      SELECT interests_deleted, counters_deleted FROM public.worker_purge_conversion_data(${now}, ${100})
    `;
    expect(rows).toEqual([{ interests_deleted: 1, counters_deleted: 1 }]);
    expect(await owner.tenantPlanInterest.count()).toBe(1);
    expect(await owner.marketingDailyCounter.count()).toBe(1);
    await expect(api.$queryRaw`SELECT * FROM public.worker_purge_conversion_data(${now}, ${100})`).rejects.toThrow();
  });
});
