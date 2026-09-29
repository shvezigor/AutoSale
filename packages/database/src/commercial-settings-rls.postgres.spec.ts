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
const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const entityA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entityB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accountA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const accountB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('commercial settings row-level security', () => {
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
      INSERT INTO tenant_legal_entities
        (id, tenant_id, display_name, legal_name, type, active, is_default, updated_at)
      VALUES
        ('${entityA}', '${tenantA}', 'Entity A', 'Fictional Entity A LLC', 'COMPANY', true, true, now()),
        ('${entityB}', '${tenantB}', 'Entity B', 'Fictional Entity B LLC', 'COMPANY', true, true, now());
      INSERT INTO tenant_bank_accounts
        (id, tenant_id, legal_entity_id, label, iban, normalized_iban, currency, active, is_default, updated_at)
      VALUES
        ('${accountA}', '${tenantA}', '${entityA}', 'Account A', 'UA111111111111111111111111111', 'UA111111111111111111111111111', 'UAH', true, true, now()),
        ('${accountB}', '${tenantB}', '${entityB}', 'Account B', 'UA222222222222222222222222222', 'UA222222222222222222222222222', 'UAH', true, true, now());
    `);
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    prisma = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('hides legal entities and accounts without context and exposes only the selected tenant', async () => {
    await expect(prisma.tenantLegalEntity.findMany()).resolves.toEqual([]);
    await expect(prisma.tenantBankAccount.findMany()).resolves.toEqual([]);

    await expect(withTenantTransaction(prisma, tenantA, async (tx) => ({
      entities: await tx.tenantLegalEntity.findMany({ select: { tenantId: true } }),
      accounts: await tx.tenantBankAccount.findMany({ select: { tenantId: true } }),
    }))).resolves.toEqual({
      entities: [{ tenantId: tenantA }],
      accounts: [{ tenantId: tenantA }],
    });
  });

  it('rejects updates to another tenant commercial settings records', async () => {
    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.tenantLegalEntity.update({
      where: { id: entityB },
      data: { displayName: 'Blocked update' },
    }))).rejects.toMatchObject({ code: 'P2025' });

    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.tenantBankAccount.update({
      where: { id: accountB },
      data: { label: 'Blocked update' },
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
