import { randomUUID } from 'node:crypto';
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
  const processIfTriggered = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationPaths = [
      '20260826090000_init_webhook_events',
      '20260826123000_conversations_messages',
      '20260826210000_product_catalog',
      '20260827160000_self_hosted_auth',
      '20260827170000_tenant_access_status',
      '20260827230000_instagram_connections',
      '20260828_meta_instagram_oauth',
      '20260828150000_instagram_oauth_attempt_guard',
      '20260829120000_instagram_credential_cleanup_queue',
      '20260831090000_catalogue_import',
      '20260831091500_catalogue_tenant_relations',
      '20260831100000_catalogue_source_object_key',
      '20260902090000_instagram_customer_profiles',
      '20260907160000_instagram_outbound_messages',
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
    expect(await prisma.instagramCustomerProfile.count({
      where: { tenantId, participantId: 'ig-user-100' },
    })).toBe(1);
    expect(await prisma.conversation.findFirstOrThrow({
      where: { tenantId, participantId: 'ig-user-100' },
    })).toMatchObject({ profileId: expect.any(String) });
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
      sourceUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });
    expect(await prisma.attachment.findFirstOrThrow()).toMatchObject({
      copyStatus: 'COPIED',
      checksum: 'checksum',
      storageKey: 'tenants/test/instagram/sha256/checksum.jpg',
    });
  });

  it('checks a durable outbound message for an order trigger', async () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'page',
          messaging: [
            {
              sender: { id: 'page' },
              recipient: { id: 'ig-customer-trigger' },
              timestamp: 1787731300123,
              message: {
                mid: 'm_manager_confirmation',
                is_echo: true,
                text: 'Дякуємо, беремо замовлення в роботу',
              },
            },
          ],
        },
      ],
    };
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'm_manager_confirmation',
        payload,
      },
    });
    const processor = new InstagramProcessor(prisma, { copy }, { processIfTriggered });

    await processor.process(event.id);

    const message = await prisma.message.findUniqueOrThrow({
      where: {
        tenantId_channel_externalMessageId: {
          tenantId,
          channel: 'INSTAGRAM',
          externalMessageId: 'm_manager_confirmation',
        },
      },
    });
    expect(processIfTriggered).toHaveBeenCalledWith(message.id);
  });

  it('links a customer profile when the first observed event is an outbound echo', async () => {
    const timestamp = new Date('2026-09-07T11:30:00.000Z');
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'mid.first-outbound-profile',
        payload: echoPayload(
          'ig-first-outbound-profile',
          'mid.first-outbound-profile',
          'Вітаємо',
          timestamp,
        ),
      },
    });

    await new InstagramProcessor(prisma, { copy }).process(event.id);

    expect(await prisma.instagramCustomerProfile.count({
      where: { tenantId, participantId: 'ig-first-outbound-profile' },
    })).toBe(1);
    await expect(prisma.conversation.findFirstOrThrow({
      where: { tenantId, participantId: 'ig-first-outbound-profile' },
    })).resolves.toMatchObject({ profileId: expect.any(String) });
  });

  it('checks a reconciled outbound Meta echo for an order trigger', async () => {
    processIfTriggered.mockReset();
    const timestamp = new Date('2026-09-07T12:00:00.000Z');
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-provider-echo',
        participantId: 'ig-provider-echo',
        lastMessageAt: timestamp,
      },
    });
    const localId = randomUUID();
    await prisma.message.create({
      data: {
        id: localId,
        tenantId,
        conversationId: conversation.id,
        rawEventId: null,
        channel: 'INSTAGRAM',
        externalMessageId: `local:${localId}`,
        direction: 'OUTBOUND',
        senderId: 'page',
        text: 'Дякуємо',
        sourceTimestamp: timestamp,
        clientIdempotencyKey: randomUUID(),
        providerMessageId: 'mid.provider.123',
        deliveryStatus: 'SENT',
      },
    });
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'mid.provider.123',
        payload: echoPayload('ig-provider-echo', 'mid.provider.123', 'Дякуємо', timestamp),
      },
    });

    await new InstagramProcessor(prisma, { copy }, { processIfTriggered }).process(event.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    await expect(prisma.message.findUniqueOrThrow({ where: { id: localId } })).resolves.toMatchObject({
      rawEventId: event.id,
      providerMessageId: 'mid.provider.123',
      deliveryStatus: 'SENT',
      deliveryErrorCode: null,
    });
    expect(processIfTriggered).toHaveBeenCalledOnce();
    expect(processIfTriggered).toHaveBeenCalledWith(localId);
  });

  it('reconciles exactly one narrow text/time candidate when the provider id is not stored yet', async () => {
    const timestamp = new Date('2026-09-07T12:10:00.000Z');
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-fallback-echo',
        participantId: 'ig-fallback-echo',
        lastMessageAt: timestamp,
      },
    });
    const localId = await seedLocalOutbound(conversation.id, 'Унікальний текст', timestamp);
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'mid.fallback.123',
        payload: echoPayload('ig-fallback-echo', 'mid.fallback.123', 'Унікальний текст', timestamp),
      },
    });

    await new InstagramProcessor(prisma, { copy }).process(event.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    await expect(prisma.message.findUniqueOrThrow({ where: { id: localId } })).resolves.toMatchObject({
      rawEventId: event.id,
      providerMessageId: 'mid.fallback.123',
      deliveryStatus: 'SENT',
    });
  });

  it('does not guess when multiple fallback candidates match the same echo', async () => {
    const timestamp = new Date('2026-09-07T12:20:00.000Z');
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-ambiguous-echo',
        participantId: 'ig-ambiguous-echo',
        lastMessageAt: timestamp,
      },
    });
    await seedLocalOutbound(conversation.id, 'Однаковий текст', timestamp);
    await seedLocalOutbound(conversation.id, 'Однаковий текст', timestamp);
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId,
        provider: 'META',
        externalEventId: 'mid.ambiguous.123',
        payload: echoPayload('ig-ambiguous-echo', 'mid.ambiguous.123', 'Однаковий текст', timestamp),
      },
    });

    await new InstagramProcessor(prisma, { copy }).process(event.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(3);
    await expect(prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, externalMessageId: 'mid.ambiguous.123' },
    })).resolves.toMatchObject({ rawEventId: event.id, providerMessageId: null });
  });

  async function seedLocalOutbound(conversationId: string, text: string, timestamp: Date): Promise<string> {
    const id = randomUUID();
    await prisma.message.create({
      data: {
        id,
        tenantId,
        conversationId,
        rawEventId: null,
        channel: 'INSTAGRAM',
        externalMessageId: `local:${id}`,
        direction: 'OUTBOUND',
        senderId: 'page',
        text,
        sourceTimestamp: timestamp,
        clientIdempotencyKey: randomUUID(),
        deliveryStatus: 'UNKNOWN',
        deliveryErrorCode: 'INSTAGRAM_DELIVERY_UNKNOWN',
      },
    });
    return id;
  }
});

function echoPayload(recipientId: string, mid: string, text: string, timestamp: Date) {
  return {
    object: 'instagram',
    entry: [{
      id: 'page',
      messaging: [{
        sender: { id: 'page' },
        recipient: { id: recipientId },
        timestamp: timestamp.getTime(),
        message: { mid, is_echo: true, text },
      }],
    }],
  };
}

async function loadFixture(name: string): Promise<Record<string, unknown>> {
  const content = await readFile(
    resolve(process.cwd(), `../../tests/fixtures/meta/${name}`),
    'utf8',
  );
  return JSON.parse(content) as Record<string, unknown>;
}
