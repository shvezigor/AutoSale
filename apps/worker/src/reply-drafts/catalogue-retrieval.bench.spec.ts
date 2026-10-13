import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createPrismaClient, withTenantTransaction, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { expect, it } from 'vitest';

import { retrieveCatalogueCandidates } from './catalogue-retrieval.js';

const searchVector = `to_tsvector('simple',
  coalesce(sku, '') || ' ' || coalesce(name, '') || ' ' ||
  coalesce(aliases::text, '') || ' ' || coalesce(brand, '') || ' ' ||
  coalesce(category, '') || ' ' || coalesce(color, '') || ' ' || coalesce(size, ''))`;

const productFields = `id, tenant_id, sku, name, aliases, brand, category, color, size,
  attributes, price, currency, stock_quantity, active, updated_at`;

type QueryCase = {
  label: string;
  sql: string;
  term: string;
  inbound: string;
  mustFindLast: boolean;
};

type Sample = { p50Ms: number; p95Ms: number; rows: number };

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.ceil(percentileValue * sorted.length) - 1] ?? 0).toFixed(2));
}

async function sample(pool: pg.Pool, sql: string, params: readonly string[]): Promise<Sample> {
  const times: number[] = [];
  let rows = 0;
  for (let iteration = 0; iteration < 35; iteration += 1) {
    const started = performance.now();
    const result = await pool.query(sql, [...params]);
    const elapsed = performance.now() - started;
    rows = result.rowCount ?? 0;
    if (iteration >= 5) times.push(elapsed);
  }
  return { p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), rows };
}

async function sampleRepository(prisma: PrismaClient, tenantId: string, inbound: string): Promise<Sample> {
  const times: number[] = [];
  let rows = 0;
  for (let iteration = 0; iteration < 35; iteration += 1) {
    const started = performance.now();
    const result = await withTenantTransaction(prisma, tenantId, (tx) =>
      retrieveCatalogueCandidates(tx, tenantId, inbound, []));
    const elapsed = performance.now() - started;
    rows = result.products.length;
    if (iteration >= 5) times.push(elapsed);
  }
  return { p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), rows };
}

function planNodes(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const names = [record['Node Type'], record['Index Name']].filter((item): item is string => typeof item === 'string');
  const children = Array.isArray(record.Plans) ? record.Plans.flatMap(planNodes) : [];
  return [...names, ...children];
}

function planMetrics(value: unknown) {
  const plan = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    actualRows: Number(plan['Actual Rows'] ?? 0),
    sharedHitBlocks: Number(plan['Shared Hit Blocks'] ?? 0),
    sharedReadBlocks: Number(plan['Shared Read Blocks'] ?? 0),
  };
}

const benchmark = process.env.RUN_CATALOGUE_BENCH === '1' ? it : it.skip;

benchmark('compares indexed recall with a correctness-matched full scan on fictional catalogues', async () => {
  const container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 });
  let prisma: PrismaClient | undefined;
  try {
    const migrations = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const name of (await readdir(migrations)).sort()) {
      if (name !== 'migration_lock.toml') {
        await pool.query(await readFile(resolve(migrations, name, 'migration.sql'), 'utf8'));
      }
    }
    const version = (await pool.query<{ server_version: string }>('SHOW server_version')).rows[0]?.server_version;
    expect(version).toContain('17.6');
    prisma = createPrismaClient(container.getConnectionUri());

    for (const count of [2_001, 10_000, 50_000]) {
      const tenantId = randomUUID();
      await pool.query('INSERT INTO tenants (id, key, name, created_at) VALUES ($1, $2, $3, now())',
        [tenantId, randomUUID(), 'Fictional benchmark shop']);
      await pool.query(`
        INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
        SELECT gen_random_uuid(), $1::uuid, 'SKU-' || lpad(n::text, 5, '0'),
          'Fictional door ' || n::text, '[]'::jsonb, true, now()
        FROM generate_series(1, $2::integer) AS n
      `, [tenantId, count]);
      const lastSku = `SKU-${String(count).padStart(5, '0')}`;
      await pool.query(`
        UPDATE products SET name = 'Fictional Region special door',
          aliases = '["Fictional Crown collection"]'::jsonb, brand = 'Fictional brand',
          category = 'Fictional doors', color = 'Fictional blue', size = '860x2050'
        WHERE tenant_id = $1::uuid AND sku = $2
      `, [tenantId, lastSku]);
      await pool.query('ANALYZE products');

      const fullScan = `SELECT ${productFields} FROM products
        WHERE tenant_id = $1::uuid AND active = true ORDER BY sku COLLATE "C", id`;
      const cases: QueryCase[] = [
        { label: 'exact_sku', term: lastSku.toLowerCase(), inbound: `Do you have ${lastSku}?`, mustFindLast: true,
          sql: `SELECT ${productFields} FROM products WHERE tenant_id = $1::uuid AND active = true
            AND lower(sku) = $2 ORDER BY sku COLLATE "C", id LIMIT 8` },
        { label: 'model', term: 'region', inbound: 'Show model Region', mustFindLast: true,
          sql: `SELECT ${productFields} FROM products WHERE tenant_id = $1::uuid AND active = true
            AND ${searchVector} @@ to_tsquery('simple', $2)
            AND lower(split_part(name, '(', 1)) LIKE '%region%'
            ORDER BY sku COLLATE "C", id LIMIT 65` },
        { label: 'name', term: 'region & special', inbound: 'Fictional Region special door', mustFindLast: true,
          sql: `SELECT ${productFields} FROM products WHERE tenant_id = $1::uuid AND active = true
            AND ${searchVector} @@ to_tsquery('simple', $2)
            ORDER BY sku COLLATE "C", id LIMIT 128` },
        { label: 'alias', term: 'crown & collection', inbound: 'Fictional Crown collection', mustFindLast: true,
          sql: `SELECT ${productFields} FROM products WHERE tenant_id = $1::uuid AND active = true
            AND ${searchVector} @@ to_tsquery('simple', $2)
            ORDER BY sku COLLATE "C", id LIMIT 128` },
        { label: 'broad', term: 'fictional', inbound: 'Fictional', mustFindLast: false,
          sql: `SELECT ${productFields} FROM products WHERE tenant_id = $1::uuid AND active = true
            AND ${searchVector} @@ to_tsquery('simple', $2)
            ORDER BY sku COLLATE "C", id LIMIT 128` },
      ];
      const baseline = await sample(pool, fullScan, [tenantId]);
      for (const queryCase of cases) {
        const indexed = await sample(pool, queryCase.sql, [tenantId, queryCase.term]);
        const repository = await sampleRepository(prisma, tenantId, queryCase.inbound);
        expect(repository.rows).toBeLessThanOrEqual(200);
        if (count === 50_000) expect(repository.p95Ms).toBeLessThanOrEqual(170);
        const matching = await pool.query<{ sku: string }>(queryCase.sql, [tenantId, queryCase.term]);
        if (queryCase.mustFindLast) expect(matching.rows.some((row) => row.sku === lastSku)).toBe(true);
        const explanation = await pool.query<{ 'QUERY PLAN': [{ Plan: unknown }] }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${queryCase.sql}`, [tenantId, queryCase.term]);
        const plan = explanation.rows[0]?.['QUERY PLAN']?.[0]?.Plan;
        // Only aggregate fictional-fixture timings and plan-node names are emitted.
        console.info(JSON.stringify({ catalogueSize: count, case: queryCase.label, postgres: version,
          warmup: 5, samples: 30, baseline, indexed, repository,
          planNodes: planNodes(plan), buffers: planMetrics(plan) }));
      }
    }
  } finally {
    await prisma?.$disconnect();
    await pool.end();
    await container.stop();
  }
}, 10 * 60_000);
