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

describe('tenant transaction context', () => {
  let container: StartedPostgreSqlContainer;
  let admin: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    admin = new pg.Pool({ connectionString: container.getConnectionUri() });
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), { apiPassword, workerPassword });
    await admin.query(`
      CREATE TABLE tenant_scoped_fixture (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        value text NOT NULL
      );
      ALTER TABLE tenant_scoped_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_scoped_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scoped_fixture_isolation ON tenant_scoped_fixture
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
      INSERT INTO tenant_scoped_fixture (id, tenant_id, value) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${tenantA}', 'tenant-a'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${tenantB}', 'tenant-b');
    `);
    prisma = createPrismaClient(runtimeUrl(container.getConnectionUri(), 'autosale_api', apiPassword));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin?.end();
    await container?.stop();
  });

  it('fails closed without context and exposes only the transaction tenant', async () => {
    await expect(prisma.$queryRaw<Array<{ value: string }>>`SELECT value FROM tenant_scoped_fixture`)
      .resolves.toEqual([]);

    await expect(withTenantTransaction(prisma, tenantA, (tx) =>
      tx.$queryRaw<Array<{ value: string }>>`SELECT value FROM tenant_scoped_fixture ORDER BY value`,
    )).resolves.toEqual([{ value: 'tenant-a' }]);

    await expect(prisma.$queryRaw<Array<{ value: string }>>`SELECT value FROM tenant_scoped_fixture`)
      .resolves.toEqual([]);
  });

  it('rejects cross-tenant writes and invalid tenant identifiers', async () => {
    await expect(withTenantTransaction(prisma, tenantA, (tx) => tx.$executeRaw`
      INSERT INTO tenant_scoped_fixture (id, tenant_id, value)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${tenantB}::uuid, 'forbidden')
    `)).rejects.toMatchObject({ code: 'P2010' });

    await expect(withTenantTransaction(prisma, 'not-a-uuid', async () => undefined))
      .rejects.toThrow(/tenant identifier/i);
  });
});

function runtimeUrl(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}
