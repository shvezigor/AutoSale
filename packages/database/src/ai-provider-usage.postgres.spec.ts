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
});
