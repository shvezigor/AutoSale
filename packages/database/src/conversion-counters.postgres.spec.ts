import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from './client.js';
import { configureRuntimeDatabaseRoles } from './runtime-database-roles.js';

describe('privacy-minimal marketing counters', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let owner: ReturnType<typeof createPrismaClient>;
  let api: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), 'prisma/migrations');
    for (const entry of (await readdir(root, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
      await pool.query(await readFile(resolve(root, entry, 'migration.sql'), 'utf8'));
    }
    owner = createPrismaClient(container.getConnectionUri());
    const passwords = { apiPassword: 'fictional-api-password-32-characters', workerPassword: 'fictional-worker-password-32-chars', backupPassword: 'fictional-backup-password-32-chars' };
    await configureRuntimeDatabaseRoles(container.getConnectionUri(), passwords);
    const apiUrl = new URL(container.getConnectionUri());
    apiUrl.username = 'autosale_api'; apiUrl.password = passwords.apiPassword;
    api = createPrismaClient(apiUrl.toString());
  }, 90_000);

  afterAll(async () => { await api?.$disconnect(); await owner?.$disconnect(); await pool?.end(); await container?.stop(); });

  it('atomically increments only fixed anonymous cells and denies raw API-role reads', async () => {
    for (let index = 0; index < 2; index += 1) {
      await api.$queryRaw`SELECT public.api_increment_marketing_counter(${'pricing_view'}, ${'uk'}, ${'none'})`;
    }
    expect(await owner.marketingDailyCounter.findMany()).toMatchObject([{ event: 'pricing_view', locale: 'uk', planId: 'none', count: 2 }]);
    await expect(api.marketingDailyCounter.findMany()).rejects.toThrow();
    await expect(api.$queryRaw`SELECT public.api_increment_marketing_counter(${'demo_intent'}, ${'uk'}, ${'none'})`).rejects.toThrow();
    expect(await owner.marketingDailyCounter.count()).toBe(1);
  });
});
