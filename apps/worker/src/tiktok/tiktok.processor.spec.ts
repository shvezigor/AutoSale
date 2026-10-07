import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, Prisma, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TikTokProcessor } from './tiktok.processor.js';

describe('TikTokProcessor', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  const copy = vi.fn();
  const processIfTriggered = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationsRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const pool = new pg.Pool({ connectionString });
    for (const migrationPath of (await readdir(migrationsRoot)).filter((name) => name !== 'migration_lock.toml').sort()) {
      await pool.query(await readFile(resolve(migrationsRoot, migrationPath, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  beforeEach(async () => {
    await prisma.tenant.deleteMany();
    tenantId = (await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional TikTok Shop' } })).id;
    copy.mockReset().mockResolvedValue({
      key: `tenants/${tenantId}/tiktok/sha256/checksum.jpg`, etag: 'etag', checksum: 'checksum', contentType: 'image/jpeg',
    });
    processIfTriggered.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists the same inbound message once and safely re-enters idempotent order recognition', async () => {
    const event = await createEvent('text-message.json', 'tiktok:fictional-message-text-001');
    const processor = new TikTokProcessor(prisma, { copy }, { processIfTriggered });
    await processor.process(tenantId, event.id);
    await processor.process(tenantId, event.id);

    await expect(prisma.message.count({ where: { tenantId, channel: 'TIKTOK' } })).resolves.toBe(1);
    await expect(prisma.conversation.findFirstOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      channel: 'TIKTOK', externalConversationId: 'fictional-conversation-001', profileId: null,
    });
    const message = await prisma.message.findFirstOrThrow({ where: { tenantId, channel: 'TIKTOK' } });
    expect(processIfTriggered).toHaveBeenNthCalledWith(1, tenantId, message.id);
    expect(processIfTriggered).toHaveBeenNthCalledWith(2, tenantId, message.id);
  });

  it('copies media through the TikTok authenticated copier and remains idempotent', async () => {
    const event = await createEvent('image-message.json', 'tiktok:fictional-message-image-001');
    const processor = new TikTokProcessor(prisma, { copy });
    await processor.process(tenantId, event.id);
    await processor.process(tenantId, event.id);

    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ tenantId, channel: 'TIKTOK' }));
    await expect(prisma.attachment.findFirstOrThrow()).resolves.toMatchObject({
      copyStatus: 'COPIED', storageKey: expect.stringContaining('/tiktok/sha256/'),
    });
  });

  it('acknowledges an outbound echo without creating a conversation or AI trigger', async () => {
    const payload = await loadFixture('text-message.json');
    payload.event = 'im_send_msg';
    const event = await prisma.webhookEvent.create({ data: {
      tenantId, provider: 'TIKTOK', externalEventId: 'tiktok:outbound-1', payload: payload as Prisma.InputJsonObject,
    } });
    await new TikTokProcessor(prisma, { copy }, { processIfTriggered }).process(tenantId, event.id);
    await expect(prisma.message.count({ where: { tenantId } })).resolves.toBe(0);
    expect(processIfTriggered).not.toHaveBeenCalled();
  });

  async function createEvent(fixtureName: string, externalEventId: string) {
    return prisma.webhookEvent.create({ data: {
      tenantId, provider: 'TIKTOK', externalEventId,
      payload: await loadFixture(fixtureName) as Prisma.InputJsonObject,
    } });
  }
});

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(process.cwd(), `../../tests/fixtures/tiktok/${name}`), 'utf8')) as Record<string, unknown>;
}
