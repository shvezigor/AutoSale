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

describe('tenant settings row-level security', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(admin);
    await admin.query(`
      INSERT INTO tenants (id, key, name) VALUES
        ('${tenantA}', 'tenant-a', 'Fictional Tenant A'),
        ('${tenantB}', 'tenant-b', 'Fictional Tenant B');
      INSERT INTO tenant_settings (id, tenant_id, trigger_phrases, updated_at) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${tenantA}', '[]'::jsonb, now()),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${tenantB}', '[]'::jsonb, now());
    `);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword, backupPassword });
    prisma = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('returns no settings without context and only the selected tenant inside a scoped transaction', async () => {
    await expect(prisma.tenantSettings.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.tenantSettings.findMany({
      select: { tenantId: true },
    }))).resolves.toEqual([{ tenantId: tenantA }]);

    await expect(withTenantTransaction(prisma, tenantB, (tx) => tx.tenantSettings.findMany({
      select: { tenantId: true },
    }))).resolves.toEqual([{ tenantId: tenantB }]);
  });

  it('rejects a write whose tenant differs from the transaction context', async () => {
    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.tenantSettings.update({
      where: { tenantId: tenantB },
      data: { autoApprovalThreshold: 0.5 },
    }))).rejects.toMatchObject({ code: 'P2025' });
  });
});

function runtimeUrl(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../prisma/migrations', import.meta.url)));
  for (const name of (await readdir(root)).sort()) {
    if (name === 'migration_lock.toml') continue;
    await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
  }
}
