import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, Prisma, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { InstagramProcessor } from './instagram.processor.js';

describe('InstagramProcessor', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  const copy = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationPaths = [
      '20260826090000_init_webhook_events',
      '20260826123000_conversations_messages',
    ];
    const pool = new pg.Pool({ connectionString });
    for (const migrationPath of migrationPaths) {
      const migration = await readFile(
        resolve(
          process.cwd(),
          `../../packages/database/prisma/migrations/${migrationPath}/migration.sql`,
        ),
        'utf8',
      );
      await pool.query(migration);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({ data: { key: 'default', name: 'Test' } });
    tenantId = tenant.id;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists the same text event exactly once', async () => {
    const payload = await loadFixture('text-message.json');
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'm_text_001',
        payload: payload as Prisma.InputJsonObject,
      },
    });
    const processor = new InstagramProcessor(prisma, { copy });

    await processor.process(event.id);
    await processor.process(event.id);

    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      status: 'PROCESSED',
      processedAt: expect.any(Date),
    });
  });

  it('copies an image after its message is durable', async () => {
    const payload = await loadFixture('image-message.json');
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'm_image_001',
        payload: payload as Prisma.InputJsonObject,
      },
    });
    copy.mockResolvedValue({
      key: 'tenants/test/instagram/sha256/checksum.jpg',
      etag: 'etag',
      checksum: 'checksum',
      contentType: 'image/jpeg',
    });
    const processor = new InstagramProcessor(prisma, { copy });

    await processor.process(event.id);

    expect(copy).toHaveBeenCalledWith({
      tenantId,
      sourceUrl: 'https://lookaside.example.test/instagram/image-001.jpg',
    });
    expect(await prisma.attachment.findFirstOrThrow()).toMatchObject({
      copyStatus: 'COPIED',
      checksum: 'checksum',
      storageKey: 'tenants/test/instagram/sha256/checksum.jpg',
    });
  });
});

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    resolve(process.cwd(), `../../tests/fixtures/meta/${name}`),
    'utf8',
  );
  return JSON.parse(content) as Record<string, unknown>;
}
