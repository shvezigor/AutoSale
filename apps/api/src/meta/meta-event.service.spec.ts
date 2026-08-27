import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetaEventService } from './meta-event.service.js';

describe('MetaEventService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: MetaEventService;
  let tenantId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    for (const migrationName of ['20260826090000_init_webhook_events', '20260827160000_self_hosted_auth', '20260827170000_tenant_access_status']) {
      const migration = await readFile(resolve(process.cwd(), `../../packages/database/prisma/migrations/${migrationName}/migration.sql`), 'utf8');
      await pool.query(migration);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({
      data: { key: 'default', name: 'Test Tenant' },
    });
    tenantId = tenant.id;
    service = new MetaEventService(prisma);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('returns the existing event when the same Meta event is replayed', async () => {
    const fixture = {
      tenantId,
      externalEventId: 'm_text_001',
      payload: { object: 'instagram', entry: [] },
    };

    const first = await service.register(fixture);
    const replay = await service.register(fixture);

    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ eventId: first.eventId, duplicate: true });
    expect(await prisma.webhookEvent.count()).toBe(1);
  });
});
