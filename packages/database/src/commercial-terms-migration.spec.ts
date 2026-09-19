import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';

describe('commercial terms migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await applyMigrations(pool);
    await pool.query("INSERT INTO tenants (id, key, name) VALUES ($1, 'commercial-test', 'Fictional Commerce')", [tenantId]);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('allows one active default entity per tenant', async () => {
    await pool.query(`INSERT INTO tenant_legal_entities
      (id, tenant_id, display_name, legal_name, type, active, is_default, updated_at)
      VALUES ($1, $2, 'Primary', 'Fictional Primary LLC', 'COMPANY', TRUE, TRUE, NOW())`, [entityId, tenantId]);
    await expect(pool.query(`INSERT INTO tenant_legal_entities
      (tenant_id, display_name, legal_name, type, active, is_default, updated_at)
      VALUES ($1, 'Second', 'Fictional Second LLC', 'COMPANY', TRUE, TRUE, NOW())`, [tenantId]))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('allows one active default account per entity and currency', async () => {
    await pool.query(`INSERT INTO tenant_bank_accounts
      (tenant_id, legal_entity_id, label, iban, normalized_iban, currency, active, is_default, updated_at)
      VALUES ($1, $2, 'UAH primary', $3, $3, 'UAH', TRUE, TRUE, NOW())`,
    [tenantId, entityId, 'UA000000000000000000000000000']);
    await expect(pool.query(`INSERT INTO tenant_bank_accounts
      (tenant_id, legal_entity_id, label, iban, normalized_iban, currency, active, is_default, updated_at)
      VALUES ($1, $2, 'UAH duplicate', $3, $3, 'UAH', TRUE, TRUE, NOW())`,
    [tenantId, entityId, 'UA000000000000000000000000001'])).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(`INSERT INTO tenant_bank_accounts
      (tenant_id, legal_entity_id, label, iban, normalized_iban, currency, active, is_default, updated_at)
      VALUES ($1, $2, 'USD primary', $3, $3, 'USD', TRUE, TRUE, NOW())`,
    [tenantId, entityId, 'UA000000000000000000000000002'])).resolves.toMatchObject({ rowCount: 1 });
  });

  it('does not invent commercial terms for existing orders', async () => {
    const count = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM order_commercial_terms');
    expect(count.rows[0]?.count).toBe('0');
  });
});

async function applyMigrations(pool: pg.Pool): Promise<void> {
  const root = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
  const migrations = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    await pool.query(await readFile(resolve(root, migration, 'migration.sql'), 'utf8'));
  }
}
