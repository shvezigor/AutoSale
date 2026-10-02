import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, Prisma, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FacebookProcessor } from './facebook.processor.js';

describe('FacebookProcessor', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  const copy = vi.fn();
  const processIfTriggered = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationsRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const migrationPaths = (await readdir(migrationsRoot)).filter((name) => name !== 'migration_lock.toml').sort();
    const pool = new pg.Pool({ connectionString });
    for (const migrationPath of migrationPaths) {
      const migration = await readFile(resolve(migrationsRoot, migrationPath, 'migration.sql'), 'utf8');
      await pool.query(migration);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    tenantId = (await prisma.tenant.create({ data: { key: 'facebook-test', name: 'Fictional Shop' } })).id;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists and triggers the same inbound Page message exactly once', async () => {
    const event = await createEvent('facebook-text-message.json', 'facebook:mid.facebook.text.001');
    const processor = new FacebookProcessor(prisma, { copy }, { processIfTriggered });

    await processor.process(tenantId, event.id);
    await processor.process(tenantId, event.id);

    await expect(prisma.conversation.findFirstOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      channel: 'FACEBOOK',
      externalConversationId: 'fictional-psid-100',
      participantId: 'fictional-psid-100',
      profileId: null,
    });
    await expect(prisma.message.count({ where: { tenantId, channel: 'FACEBOOK' } })).resolves.toBe(1);
    await expect(prisma.instagramCustomerProfile.count({ where: { tenantId } })).resolves.toBe(0);
    expect(processIfTriggered).toHaveBeenCalledTimes(1);
  });

  it('copies Page image attachments into a Facebook-scoped media key', async () => {
    const event = await createEvent('facebook-image-message.json', 'facebook:mid.facebook.image.001');
    copy.mockResolvedValueOnce({
      key: `tenants/${tenantId}/facebook/sha256/checksum.jpg`,
      etag: 'etag',
      checksum: 'checksum',
      contentType: 'image/jpeg',
    });
    const processor = new FacebookProcessor(prisma, { copy });

    await processor.process(tenantId, event.id);

    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ tenantId, channel: 'FACEBOOK' }));
    await expect(prisma.attachment.findFirstOrThrow({ where: { message: { rawEventId: event.id } } }))
      .resolves.toMatchObject({ copyStatus: 'COPIED', checksum: 'checksum' });
  });

  async function createEvent(fixtureName: string, externalEventId: string) {
    const payload = JSON.parse(await readFile(
      resolve(process.cwd(), `../../tests/fixtures/meta/${fixtureName}`),
      'utf8',
    )) as Prisma.InputJsonObject;
    return prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId, payload },
    });
  }
});
