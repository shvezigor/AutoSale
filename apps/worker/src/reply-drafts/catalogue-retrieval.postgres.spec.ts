import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('AI catalogue retrieval indexes', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const name of (await readdir(root)).sort()) {
      if (name !== 'migration_lock.toml') {
        await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
      }
    }
    await pool.end();
    prisma = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('has active-product exact SKU and full-text indexes', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'products'
    `;
    expect(indexes.find((row) => row.indexname === 'products_ai_search_fts_idx')?.indexdef)
      .toContain("to_tsvector('simple'");
    expect(indexes.find((row) => row.indexname === 'products_ai_search_sku_idx')?.indexdef)
      .toContain('lower(sku)');
  });

  it('documents the old 2,000-SKU prefix correctness gap', async () => {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional catalogue shop' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        ${tenant.id}::uuid, 'SKU-' || lpad(n::text, 5, '0'),
        'Fictional door ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 2001) AS n
    `;
    const oldPrefix = await prisma.product.findMany({
      where: { tenantId: tenant.id, active: true },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: 2_000,
      select: { sku: true },
    });
    expect(oldPrefix).toHaveLength(2_000);
    expect(oldPrefix.some((product) => product.sku === 'SKU-02001')).toBe(false);
    expect(await prisma.product.count({ where: { tenantId: tenant.id, sku: 'SKU-02001' } })).toBe(1);
  });
});
