import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { configureRuntimeDatabaseRoles, createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { selectCatalogueCandidates } from './catalogue-candidates.js';
import { retrieveCatalogueCandidates } from './catalogue-retrieval.js';

describe('AI catalogue retrieval indexes', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let worker: PrismaClient;

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
    const workerPassword = 'fictional-catalogue-worker-password-32-chars';
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), {
      apiPassword: 'fictional-catalogue-api-password-32-chars',
      workerPassword,
      backupPassword: 'fictional-catalogue-backup-password-32-chars',
    });
    const runtimeUrl = new URL(container.getConnectionUri());
    runtimeUrl.username = 'autosale_worker';
    runtimeUrl.password = workerPassword;
    worker = createPrismaClient(runtimeUrl.toString());
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await worker?.$disconnect();
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

  it('recalls the 2,001st active product by SKU, model, full name and alias', async () => {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional retrieval shop' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${tenant.id}::uuid, 'SKU-' || lpad(n::text, 5, '0'),
        'Fictional generic door ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 2001) AS n
    `;
    const last = await prisma.product.update({ where: { tenantId_sku: { tenantId: tenant.id, sku: 'SKU-02001' } },
      data: { name: '860х2050 Регіон (плівка мат)',
        aliases: ['Коронна серія Регіон'], stockQuantity: 0, price: '2400.00', currency: 'UAH' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${tenant.id}::uuid, 'AAA-' || lpad(n::text, 5, '0'),
        'Коронна accessory ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 300) AS n
    `;
    const oldPrefix = await prisma.product.findMany({ where: { tenantId: tenant.id, active: true },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: 2_000, select: { id: true } });
    expect(oldPrefix.some((product) => product.id === last.id)).toBe(false);
    const queries = [
      'Чи є SKU-02001?',
      'Покажіть модель Регіон',
      '860х2050 Регіон (плівка мат)',
      'Чи доступна Коронна серія Регіон?',
    ];
    for (const query of queries) {
      const result = await withTenantTransaction(worker, tenant.id, (tx) =>
        retrieveCatalogueCandidates(tx, tenant.id, query, []));
      const sources = selectCatalogueCandidates(result.products, tenant.id, query, []);
      expect(sources.map((source) => source.productId), query).toContain(last.id);
      expect(sources.find((source) => source.productId === last.id)?.stockQuantity).toBe(0);
      expect(result.products.length).toBeLessThanOrEqual(200);
    }
  });

  it('reports an overflowing explicit model family without counting compatibility-only names', async () => {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional variants shop' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${tenant.id}::uuid, 'REGION-' || lpad(n::text, 3, '0'),
        'Регіон варіант ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 65) AS n
    `;
    await prisma.product.create({ data: { tenantId: tenant.id, sku: 'LOCK-1',
      name: 'Додатковий замок (Регіон, Колізей)', aliases: [] } });
    const query = 'Покажіть модель Регіон';
    const result = await withTenantTransaction(worker, tenant.id, (tx) =>
      retrieveCatalogueCandidates(tx, tenant.id, query, []));
    expect(result.modelOverflow).toBe(true);
    expect(result.products).toEqual([]);
  });

  it('prefers the rarer named model over a generic product-type word', async () => {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional model family shop' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${tenant.id}::uuid, 'DOORS-' || lpad(n::text, 3, '0'),
        'Дверей Авангард ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 70) AS n
    `;
    const region = await prisma.product.create({ data: { tenantId: tenant.id, sku: 'REGION-1',
      name: '860х2050 Регіон (плівка мат)', aliases: [] } });
    const result = await withTenantTransaction(worker, tenant.id, (tx) =>
      retrieveCatalogueCandidates(tx, tenant.id, 'Які ще моделі дверей Регіон є?', []));
    expect(result.modelOverflow).toBe(false);
    expect(result.products.map((product) => product.id)).toEqual([region.id]);
  });

  it('bounds broad recall and excludes inactive or other-tenant products under worker RLS', async () => {
    const tenantA = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional tenant A' } });
    const tenantB = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional tenant B' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${tenantA.id}::uuid, 'BROAD-' || lpad(n::text, 4, '0'),
        'Fictional broad door ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 300) AS n
    `;
    await prisma.product.create({ data: { tenantId: tenantA.id, sku: 'CROSS-1',
      name: 'Fictional cross door', aliases: [], active: false } });
    await prisma.product.create({ data: { tenantId: tenantB.id, sku: 'CROSS-1',
      name: 'Fictional cross door', aliases: [] } });
    const broad = await withTenantTransaction(worker, tenantA.id, (tx) =>
      retrieveCatalogueCandidates(tx, tenantA.id, 'Fictional broad door', []));
    expect(broad.products.length).toBeLessThanOrEqual(200);
    expect(broad.products.every((product) => product.tenantId === tenantA.id && product.active)).toBe(true);
    const foreign = await withTenantTransaction(worker, tenantA.id, (tx) =>
      retrieveCatalogueCandidates(tx, tenantB.id, 'CROSS-1', []));
    expect(foreign.products).toEqual([]);
  });
});
