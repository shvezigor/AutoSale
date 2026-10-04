import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createPrismaClient, type PrismaClient } from '@autosale/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MetaEventService } from './meta-event.service.js';

function channelGate(enabled: boolean) {
  return {
    getControl: async () => ({
      key: 'FACEBOOK_MESSENGER', deploymentAvailable: true, runtimeEnabled: enabled,
      effectiveEnabled: enabled, state: enabled ? 'ACTIVE' : 'ADMIN_DISABLED', updatedAt: null,
    }),
  } as never;
}

describe('MetaEventService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: MetaEventService;
  let tenantId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    const migrationsRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const migrationName of (await readdir(migrationsRoot)).sort()) {
      if (migrationName === 'migration_lock.toml') continue;
      const migration = await readFile(resolve(process.cwd(), `../../packages/database/prisma/migrations/${migrationName}/migration.sql`), 'utf8');
      await pool.query(migration);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({
      data: { key: 'default', name: 'Test Tenant' },
    });
    tenantId = tenant.id;
    service = new MetaEventService(prisma, channelGate(false));
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('rejects and transitions an expired active Instagram connection before webhook processing', async () => {
    const connection = await prisma.instagramConnection.create({ data: { tenantId, externalAccountId: '17841400000000000', status: 'ACTIVE', tokenExpiresAt: new Date('2026-08-28T11:59:59.999Z') } });
    const expiredService = new MetaEventService(
      prisma, channelGate(false), () => new Date('2026-08-28T12:00:00.000Z'),
    );
    await expect(expiredService.resolveTenant('INSTAGRAM', connection.externalAccountId)).resolves.toBeNull();
    await expect(prisma.instagramConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({ status: 'REAUTH_REQUIRED', lastErrorCode: 'META_TOKEN_EXPIRED' });
  });

  it('resolves only an active Facebook Page when the feature is enabled', async () => {
    const connection = await prisma.facebookConnection.create({
      data: {
        tenantId,
        externalPageId: 'fictional-page-100',
        pageName: 'Fictional Page',
        status: 'ACTIVE',
      },
    });
    const enabledService = new MetaEventService(
      prisma, channelGate(true), () => new Date('2026-10-02T12:00:00.000Z'),
    );

    await expect(enabledService.resolveTenant('FACEBOOK', connection.externalPageId)).resolves.toBe(tenantId);
    await expect(service.resolveTenant('FACEBOOK', connection.externalPageId)).resolves.toBeNull();

    await prisma.facebookConnection.update({ where: { id: connection.id }, data: { status: 'DISCONNECTED' } });
    await expect(enabledService.resolveTenant('FACEBOOK', connection.externalPageId)).resolves.toBeNull();
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
    if (!first.eventId) throw new Error('Expected a durable event');
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
    if (!registered.eventId) throw new Error('Expected a durable event');

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

  it('acknowledges but does not retain a Meta event after tenant ingestion is frozen', async () => {
    const user = await prisma.user.create({
      data: { email: 'lifecycle-admin@example.test', name: 'Fictional Admin', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' },
    });
    await prisma.tenantLifecycleRequest.create({ data: {
      tenantId,
      kind: 'DELETE',
      status: 'EXPORTING',
      reasonCode: 'ADMINISTRATIVE_TEST',
      requestedByUserId: user.id,
      idempotencyKey: '11111111-2222-4333-8444-555555555555',
      requestHash: 'f'.repeat(64),
      ingestionFrozenAt: new Date(),
    } });
    const before = await prisma.webhookEvent.count({ where: { tenantId } });

    await expect(service.register({
      tenantId,
      externalEventId: 'm_frozen_001',
      payload: { object: 'instagram', entry: [] },
    })).resolves.toEqual({ eventId: null, duplicate: false, pending: false, frozen: true });
    await expect(prisma.webhookEvent.count({ where: { tenantId } })).resolves.toBe(before);
  });
});
