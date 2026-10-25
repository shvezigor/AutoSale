import { randomUUID } from 'node:crypto';
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

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const passwords = {
  apiPassword: 'fictional-api-password-32-characters',
  workerPassword: 'fictional-worker-password-32-chars',
  backupPassword: 'fictional-backup-password-32-chars',
};
const startedAt = new Date('2026-10-24T09:00:00Z');
const finalizedAt = new Date('2026-10-24T09:00:01Z');
const emptyUsage = { inputTokens: null, outputTokens: null, cachedInputTokens: null };
const attempt = (id = randomUUID()) => ({
  id, tenantId: tenantA, operationId: randomUUID(), purpose: 'REPLY_DRAFT' as const,
  provider: 'OPENAI' as const, requestedModel: 'fictional-model', startedAt,
});

describe('AI provider usage ledger PostgreSQL contract', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let api: PrismaClient;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
    for (const name of (await readdir(root)).sort()) {
      // Exercise the upgrade path with runtime roles/default privileges already present.
      if (name === '20261025_ai_provider_usage_maintenance') {
        await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
      }
      if (name !== 'migration_lock.toml') await admin.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
    }
    for (const [id, key] of [[tenantA, 'fictional-alpha'], [tenantB, 'fictional-beta']]) {
      await admin.query('INSERT INTO tenants (id, key, name) VALUES ($1, $2, $2)', [id, key]);
    }
    // Run bootstrap twice: its broad grants must never restore ledger mutation privileges.
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    const runtimeUrl = (username: string, password: string) => {
      const url = new URL(container.getConnectionUri());
      url.username = username;
      url.password = password;
      return url.toString();
    };
    api = createPrismaClient(runtimeUrl('autosale_api', passwords.apiPassword));
    worker = createPrismaClient(runtimeUrl('autosale_worker', passwords.workerPassword));
  }, 60_000);

  afterAll(async () => {
    await api?.$disconnect();
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('fails closed without context and denies cross-tenant reads, inserts and updates', async () => {
    const row = attempt();
    await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.create({ data: row }));
    expect(await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.findMany({
      select: { tenantId: true },
    }))).toEqual([{ tenantId: tenantA }]);
    expect(await worker.aiProviderUsageAttempt.findMany()).toEqual([]);
    expect(await withTenantTransaction(worker, tenantB, (tx) => tx.aiProviderUsageAttempt.findMany())).toEqual([]);
    await expect(worker.aiProviderUsageAttempt.create({ data: attempt() })).rejects.toBeDefined();
    await expect(withTenantTransaction(worker, tenantB, (tx) => tx.aiProviderUsageAttempt.create({ data: attempt() })))
      .rejects.toBeDefined();
    expect(await withTenantTransaction(worker, tenantB, (tx) => tx.aiProviderUsageAttempt.updateMany({
      where: { id: row.id }, data: { outcome: 'NOT_SENT', finalizedAt },
    }))).toEqual({ count: 0 });
    await expect(withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.update({
      where: { id: row.id }, data: { tenantId: tenantB },
    }))).rejects.toBeDefined();
  });

  it('denies API writes and both runtime roles direct deletion even with tenant context', async () => {
    const row = attempt();
    await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.create({ data: row }));
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiProviderUsageAttempt.create({ data: attempt() })))
      .rejects.toBeDefined();
    await expect(withTenantTransaction(api, tenantA, (tx) => tx.aiProviderUsageAttempt.updateMany({
      where: { id: row.id }, data: { requestedModel: 'different-model' },
    }))).rejects.toBeDefined();
    for (const prisma of [api, worker]) {
      await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.aiProviderUsageAttempt.deleteMany()))
        .rejects.toBeDefined();
    }
    const privileges = await admin.query(`SELECT
      has_table_privilege('autosale_api', 'ai_provider_usage_attempts', 'INSERT,UPDATE,DELETE') AS api_write,
      has_table_privilege('autosale_worker', 'ai_provider_usage_attempts', 'DELETE') AS worker_delete`);
    expect(privileges.rows).toEqual([{ api_write: false, worker_delete: false }]);
  });

  it('persists zero and missing/partial usage and finalizes only once inside the tenant context', async () => {
    const { AiProviderUsageStore } = await import('./ai-provider-usage.js');
    const store = new AiProviderUsageStore(worker);
    const context = { tenantId: tenantA, operationId: randomUUID(), purpose: 'ORDER_RECOGNITION' as const };
    const id = randomUUID();
    await store.start(context, 'fictional-requested', id, startedAt);
    expect(await store.finalize({ ...context, tenantId: tenantB }, id, 'REPORTED', {
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
    }, 'fictional-returned', finalizedAt)).toBe(false);
    expect(await store.finalize(context, id, 'REPORTED', {
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
    }, 'fictional-returned', finalizedAt)).toBe(true);
    expect(await store.finalize(context, id, 'REPORTED', {
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
    }, 'fictional-returned', finalizedAt)).toBe(false);
    const row = await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.findUniqueOrThrow({ where: { id } }));
    expect(row).toMatchObject({ ...context, provider: 'OPENAI', requestedModel: 'fictional-requested',
      returnedModel: 'fictional-returned', outcome: 'REPORTED', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
      startedAt, finalizedAt });
    for (const usage of [emptyUsage, { inputTokens: 7, outputTokens: null, cachedInputTokens: 2 }]) {
      const missingId = randomUUID();
      await store.start(context, 'fictional-model', missingId, startedAt);
      expect(await store.finalize(context, missingId, 'USAGE_MISSING', usage, null, finalizedAt)).toBe(true);
      expect(await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.findUniqueOrThrow({
        where: { id: missingId },
      }))).toMatchObject({ ...usage, outcome: 'USAGE_MISSING' });
    }
    for (const outcome of ['CHARGE_UNKNOWN', 'NOT_SENT'] as const) {
      const terminalId = randomUUID();
      const errorCategory = outcome === 'CHARGE_UNKNOWN' ? 'TIMEOUT' : 'PRE_DISPATCH_FAILURE';
      await store.start(context, 'fictional-model', terminalId, startedAt);
      expect(await store.finalize(context, terminalId, outcome, emptyUsage, null, finalizedAt, errorCategory)).toBe(true);
      expect(await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.findUniqueOrThrow({
        where: { id: terminalId },
      }))).toMatchObject({ ...emptyUsage, outcome, errorCategory });
    }
  });

  it('rejects negative or contradictory usage and terminal-row changes at the database boundary', async () => {
    const invalidRows = [
      { outcome: 'REPORTED', finalizedAt, inputTokens: -1, outputTokens: 0 },
      { outcome: 'REPORTED', finalizedAt, inputTokens: 2, outputTokens: -1 },
      { outcome: 'REPORTED', finalizedAt, inputTokens: 2, outputTokens: 0, cachedInputTokens: -1 },
      { outcome: 'REPORTED', finalizedAt, inputTokens: 2, outputTokens: 0, cachedInputTokens: 3 },
      { outcome: 'REPORTED', finalizedAt, inputTokens: null, outputTokens: 0 },
      { outcome: 'USAGE_MISSING', finalizedAt, inputTokens: 0, outputTokens: 0 },
      { outcome: 'USAGE_MISSING', finalizedAt, cachedInputTokens: 1 },
      { outcome: 'CHARGE_UNKNOWN', finalizedAt, inputTokens: 0 },
      { outcome: 'NOT_SENT', finalizedAt, outputTokens: 0 },
      { outcome: 'STARTED', finalizedAt },
      { outcome: 'STARTED', inputTokens: 0 },
      { outcome: 'NOT_SENT' },
      { outcome: 'NOT_SENT', finalizedAt: new Date('2026-10-24T08:59:59Z') },
      { outcome: 'NOT_SENT', finalizedAt, errorCategory: 'raw provider error with credentials' },
    ];
    for (const invalid of invalidRows) {
      await expect(withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.create({
        data: { ...attempt(), ...invalid } as never,
      }))).rejects.toBeDefined();
    }
    const row = attempt();
    await withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.create({
      data: { ...row, outcome: 'REPORTED', finalizedAt, inputTokens: 0, outputTokens: 0 },
    }));
    await expect(withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.update({
      where: { id: row.id }, data: { inputTokens: 9 },
    }))).rejects.toBeDefined();
    await expect(withTenantTransaction(worker, tenantA, (tx) => tx.aiProviderUsageAttempt.update({
      where: { id: row.id }, data: { outcome: 'STARTED', finalizedAt: null, inputTokens: null, outputTokens: null },
    }))).rejects.toBeDefined();
  });

  it('allows in-flight finalization after freeze without changing immutable terminal evidence', async () => {
    const { AiProviderUsageStore } = await import('./ai-provider-usage.js');
    const store = new AiProviderUsageStore(worker);
    const context = { tenantId: tenantB, operationId: randomUUID(), purpose: 'ORDER_RECOGNITION' as const };
    const id = randomUUID();
    await store.start(context, 'fictional-model', id, startedAt);
    const lifecycleId = randomUUID();
    await admin.query(`INSERT INTO tenant_lifecycle_requests
      (id, tenant_id, kind, status, reason_code, requested_by_user_id, idempotency_key, request_hash, ingestion_frozen_at, updated_at)
      VALUES ($1,$2,'DELETE','EXPORT_READY','ADMINISTRATIVE_TEST',$3,$4,$5,$6,$6)`,
    [lifecycleId, tenantB, randomUUID(), randomUUID(), 'f'.repeat(64), finalizedAt]);
    try {
      expect(await store.finalize(context, id, 'REPORTED', { inputTokens: 7, outputTokens: 2, cachedInputTokens: null }, 'fictional-model', finalizedAt)).toBe(true);
      expect(await store.finalize(context, id, 'CHARGE_UNKNOWN', emptyUsage, null, finalizedAt, 'ORPHANED')).toBe(false);
      expect(await withTenantTransaction(worker, tenantB, (tx) => tx.aiProviderUsageAttempt.findUniqueOrThrow({ where: { id } })))
        .toMatchObject({ outcome: 'REPORTED', inputTokens: 7, outputTokens: 2 });
    } finally {
      await admin.query('DELETE FROM tenant_lifecycle_requests WHERE id=$1', [lifecycleId]);
    }
  });

  it('exposes bounded maintenance functions only to worker, including after repeated role bootstrap', async () => {
    for (const name of ['worker_due_ai_provider_usage_attempts', 'worker_purge_ai_provider_usage_attempts']) {
      await expect(api.$queryRawUnsafe(`SELECT * FROM public.${name}($1::timestamptz, $2::int)`, finalizedAt, 100)).rejects.toBeDefined();
      const privileges = await admin.query(`SELECT
        has_function_privilege('autosale_worker', $1, 'EXECUTE') AS worker,
        has_function_privilege('autosale_api', $1, 'EXECUTE') AS api,
        has_function_privilege('autosale_backup', $1, 'EXECUTE') AS backup`, [`public.${name}(timestamp with time zone,integer)`]);
      expect(privileges.rows).toEqual([{ worker: true, api: false, backup: false }]);
      const metadata = await admin.query(`SELECT p.prosecdef, p.proconfig,
        EXISTS (SELECT 1 FROM aclexplode(p.proacl) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`, [name]);
      expect(metadata.rows).toEqual([{ prosecdef: true, proconfig: ['search_path=pg_catalog, public'], public_execute: false }]);
    }
  });

  it('hard caps SQL discovery/deletion and never purges STARTED or recently finalized rows', async () => {
    await admin.query('DELETE FROM ai_provider_usage_attempts');
    const now = new Date('2026-10-25T12:00:00Z');
    for (let i = 0; i < 105; i++) {
      await admin.query(`INSERT INTO ai_provider_usage_attempts
        (id,tenant_id,purpose,operation_id,requested_model,started_at,outcome,finalized_at)
        VALUES ($1,$2,'ORDER_INTENT',$3,'fictional-model','2026-01-01','STARTED',NULL),
          ($4,$5,'ORDER_INTENT',$6,'fictional-model','2026-01-01','NOT_SENT','2026-01-02')`,
      [randomUUID(), i % 2 ? tenantA : tenantB, randomUUID(), randomUUID(), i % 2 ? tenantB : tenantA, randomUUID()]);
    }
    const due = (limit: number | null) => worker.$queryRawUnsafe<Array<{ tenant_id: string; attempt_id: string }>>(
      'SELECT * FROM public.worker_due_ai_provider_usage_attempts($1::timestamptz,$2::int)', now, limit);
    expect(await due(10_000)).toHaveLength(100);
    expect(await due(0)).toHaveLength(1);
    expect(await due(-1)).toHaveLength(1);
    expect(await due(null)).toHaveLength(1);
    expect(new Set((await due(100)).map((row) => row.tenant_id))).toEqual(new Set([tenantA, tenantB]));
    expect(Object.keys((await due(1))[0]!).sort()).toEqual(['attempt_id', 'tenant_id']);
    const purge = (limit: number | null) => worker.$queryRawUnsafe<Array<{ purged: number }>>(
      'SELECT public.worker_purge_ai_provider_usage_attempts($1::timestamptz,$2::int) AS purged', now, limit);
    expect(await purge(0)).toEqual([{ purged: 1 }]);
    expect(await purge(-1)).toEqual([{ purged: 1 }]);
    expect(await purge(null)).toEqual([{ purged: 1 }]);
    expect(await purge(10_000)).toEqual([{ purged: 100 }]);
    expect(await purge(100)).toEqual([{ purged: 2 }]);
    expect(await purge(100)).toEqual([{ purged: 0 }]);
    expect((await admin.query("SELECT count(*)::int AS count FROM ai_provider_usage_attempts WHERE outcome='STARTED'")).rows).toEqual([{ count: 105 }]);
  });
});
