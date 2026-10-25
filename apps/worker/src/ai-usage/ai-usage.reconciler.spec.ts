import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { configureRuntimeDatabaseRoles, createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiUsageReconciler } from './ai-usage.reconciler.js';

const { providerCreate } = vi.hoisted(() => ({ providerCreate: vi.fn(() => { throw new Error('Provider dispatch forbidden'); }) }));
vi.mock('openai', () => ({ default: class { responses = { create: providerCreate }; } }));

const now = new Date('2026-10-25T12:00:00Z');
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

describe('AiUsageReconciler with worker database identity', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let worker: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    const migrations = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const migration of (await readdir(migrations)).sort()) {
      if (migration !== 'migration_lock.toml') await admin.query(await readFile(resolve(migrations, migration, 'migration.sql'), 'utf8'));
    }
    await admin.query(`INSERT INTO tenants (id, key, name) VALUES ($1, 'fictional-alpha', 'Fictional Alpha'), ($2, 'fictional-beta', 'Fictional Beta')`, [tenantA, tenantB]);
    const passwords = { apiPassword: 'fictional-api-password-32-characters', workerPassword: 'fictional-worker-password-32-chars', backupPassword: 'fictional-backup-password-32-chars' };
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    const url = new URL(container.getConnectionUri());
    url.username = 'autosale_worker';
    url.password = passwords.workerPassword;
    worker = createPrismaClient(url.toString());
  }, 60_000);

  beforeEach(async () => {
    await admin.query('DELETE FROM ai_provider_usage_attempts');
    await admin.query('DELETE FROM tenant_lifecycle_requests');
    providerCreate.mockClear();
  });

  afterAll(async () => {
    await worker?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  async function seed(tenantId: string, startedAt: string, finalizedAt?: string): Promise<string> {
    const id = randomUUID();
    await admin.query(`INSERT INTO ai_provider_usage_attempts
      (id, tenant_id, purpose, operation_id, requested_model, started_at, outcome, finalized_at)
      VALUES ($1, $2, 'REPLY_DRAFT', $3, 'fictional-model', $4, $5, $6)`,
    [id, tenantId, randomUUID(), startedAt, finalizedAt ? 'USAGE_MISSING' : 'STARTED', finalizedAt ?? null]);
    return id;
  }

  it('reconciles overdue attempts across tenants without provider dispatch and preserves fresh/boundary attempts', async () => {
    const overdue = await seed(tenantA, '2026-10-25T11:44:59Z');
    const other = await seed(tenantB, '2026-10-25T11:00:00Z');
    const boundary = await seed(tenantB, '2026-10-25T11:45:00Z');
    const fresh = await seed(tenantA, '2026-10-25T11:59:00Z');
    const reconciler = new AiUsageReconciler(worker);
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 2, purged: 0 });
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 0, purged: 0 });
    for (const id of [overdue, other]) {
      expect((await admin.query('SELECT outcome, error_category, finalized_at, input_tokens, output_tokens FROM ai_provider_usage_attempts WHERE id=$1', [id])).rows)
        .toEqual([{ outcome: 'CHARGE_UNKNOWN', error_category: 'ORPHANED', finalized_at: now, input_tokens: null, output_tokens: null }]);
    }
    expect((await admin.query('SELECT id FROM ai_provider_usage_attempts WHERE outcome=\'STARTED\' ORDER BY id')).rows.map((row) => row.id).sort()).toEqual([boundary, fresh].sort());
    expect(providerCreate).not.toHaveBeenCalled();
    expect(await worker.aiProviderUsageAttempt.findMany()).toEqual([]);
  });

  it('keeps terminal deletion OFF by default independently of orphan repair', async () => {
    await seed(tenantA, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
    await seed(tenantB, '2026-01-01T00:00:00Z');
    expect(await new AiUsageReconciler(worker).reconcile(now)).toEqual({ unknown: 1, purged: 0 });
    expect((await admin.query('SELECT count(*)::int AS count FROM ai_provider_usage_attempts')).rows[0].count).toBe(2);
  });

  it('purges only terminal rows finalized more than 90 days ago and retains newly reconciled ancient starts', async () => {
    const expired = await seed(tenantA, '2026-07-01T00:00:00Z', '2026-07-27T11:59:59Z');
    const boundary = await seed(tenantB, '2026-07-01T00:00:00Z', '2026-07-27T12:00:00Z');
    const recent = await seed(tenantB, '2026-01-01T00:00:00Z', '2026-10-25T11:59:00Z');
    const orphan = await seed(tenantA, '2026-01-01T00:00:00Z');
    const reconciler = new AiUsageReconciler(worker, true);
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 1, purged: 1 });
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 0, purged: 0 });
    expect((await admin.query('SELECT id FROM ai_provider_usage_attempts')).rows.map((row) => row.id).sort()).toEqual([boundary, recent, orphan].sort());
    expect((await admin.query('SELECT id FROM ai_provider_usage_attempts WHERE id=$1', [expired])).rows).toEqual([]);
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it('bounds orphan finalization and terminal deletion to 100 each per pass', async () => {
    for (let i = 0; i < 103; i++) {
      await seed(i % 2 ? tenantA : tenantB, '2026-01-01T00:00:00Z');
      await seed(i % 2 ? tenantB : tenantA, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
    }
    const reconciler = new AiUsageReconciler(worker, true);
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 100, purged: 100 });
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 3, purged: 3 });
    expect(await reconciler.reconcile(now)).toEqual({ unknown: 0, purged: 0 });
  });

  it('repairs an already dispatched attempt for a frozen tenant', async () => {
    const id = await seed(tenantB, '2026-10-25T10:00:00Z');
    await admin.query(`INSERT INTO tenant_lifecycle_requests
      (id, tenant_id, kind, status, reason_code, requested_by_user_id, idempotency_key, request_hash, ingestion_frozen_at, updated_at)
      VALUES ($1,$2,'DELETE','EXPORT_READY','ADMINISTRATIVE_TEST',$3,$4,$5,$6,$6)`,
    [randomUUID(), tenantB, randomUUID(), randomUUID(), 'f'.repeat(64), now]);
    expect(await new AiUsageReconciler(worker).reconcile(now)).toEqual({ unknown: 1, purged: 0 });
    expect(await withTenantTransaction(worker, tenantB, (tx) => tx.aiProviderUsageAttempt.findUnique({ where: { id } })))
      .toMatchObject({ outcome: 'CHARGE_UNKNOWN', errorCategory: 'ORPHANED' });
    expect(providerCreate).not.toHaveBeenCalled();
  });

  it('concurrent passes finalize each orphan only once', async () => {
    await seed(tenantA, '2026-10-25T10:00:00Z');
    await seed(tenantB, '2026-10-25T10:00:00Z');
    const results = await Promise.all([
      new AiUsageReconciler(worker).reconcile(now),
      new AiUsageReconciler(worker).reconcile(now),
    ]);
    expect(results.reduce((total, result) => total + result.unknown, 0)).toBe(2);
    expect(await new AiUsageReconciler(worker).reconcile(now)).toEqual({ unknown: 0, purged: 0 });
  });
});
