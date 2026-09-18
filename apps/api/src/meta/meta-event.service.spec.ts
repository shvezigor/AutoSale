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
    for (const migrationName of ['20260826090000_init_webhook_events', '20260827160000_self_hosted_auth', '20260827170000_tenant_access_status', '20260827230000_instagram_connections', '20260828_meta_instagram_oauth', '20260828150000_instagram_oauth_attempt_guard', '20260829120000_instagram_credential_cleanup_queue']) {
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

  it('rejects and transitions an expired active Instagram connection before webhook processing', async () => {
    const connection = await prisma.instagramConnection.create({ data: { tenantId, externalAccountId: '17841400000000000', status: 'ACTIVE', tokenExpiresAt: new Date('2026-08-28T11:59:59.999Z') } });
    const expiredService = new MetaEventService(prisma, () => new Date('2026-08-28T12:00:00.000Z'));
    await expect(expiredService.resolveTenant(connection.externalAccountId)).resolves.toBeNull();
    await expect(prisma.instagramConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({ status: 'REAUTH_REQUIRED', lastErrorCode: 'META_TOKEN_EXPIRED' });
  });

  it('returns the existing event when the same Meta event is replayed', async () => {
    const fixture = {
      tenantId,
      externalEventId: 'm_text_001',
      payload: { object: 'instagram', entry: [] },
    };

    const first = await service.register(fixture);
    const replay = await service.register(fixture);

    expect(first).toEqual({ eventId: expect.any(String), duplicate: false, pending: true });
    expect(replay).toEqual({ eventId: first.eventId, duplicate: true, pending: true });
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it('reports a processed replay as no longer pending dispatch', async () => {
    const first = await service.register({
      tenantId,
      externalEventId: 'm_processed_001',
      payload: { object: 'instagram', entry: [] },
    });
    await prisma.webhookEvent.update({
      where: { id: first.eventId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    await expect(
      service.register({
        tenantId,
        externalEventId: 'm_processed_001',
        payload: { object: 'instagram', entry: [] },
      }),
    ).resolves.toEqual({ eventId: first.eventId, duplicate: true, pending: false });
  });

  it('redacts token-shaped fields before retaining a webhook payload', async () => {
    const registered = await service.register({
      tenantId,
      externalEventId: 'm_secret_001',
      payload: {
        object: 'instagram',
        access_token: 'top-level-secret',
        entry: [{ id: 'account', messaging: [{ appsecret_proof: 'nested-secret' }] }],
      },
    });

    const stored = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: registered.eventId },
      select: { payload: true },
    });
    expect(JSON.stringify(stored.payload)).not.toContain('top-level-secret');
    expect(JSON.stringify(stored.payload)).not.toContain('nested-secret');
    expect(stored.payload).toEqual({
      object: 'instagram',
      access_token: '[REDACTED]',
      entry: [{ id: 'account', messaging: [{ appsecret_proof: '[REDACTED]' }] }],
    });
  });
});
