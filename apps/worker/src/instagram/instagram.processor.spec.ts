import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
  const scheduleReplyDraft = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const migrationsRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const migrationPaths = (await readdir(migrationsRoot)).filter((name) => name !== 'migration_lock.toml').sort();
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
    const processor = new InstagramProcessor(
      prisma,
      { copy },
      undefined,
      { schedule: scheduleReplyDraft },
    );

    await processor.process(tenantId, event.id);
    await processor.process(tenantId, event.id);

    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);
    const message = await prisma.message.findFirstOrThrow({ where: { tenantId, externalMessageId: 'm_text_001' } });
    expect(scheduleReplyDraft).toHaveBeenNthCalledWith(1, tenantId, message.id);
    expect(scheduleReplyDraft).toHaveBeenNthCalledWith(2, tenantId, message.id);
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

  it('retries idempotent order recognition when the same inbound text event is delivered again', async () => {
    processIfTriggered.mockReset()
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('fictional conflict', {
        code: 'P2034', clientVersion: 'test',
      }))
      .mockResolvedValueOnce(null);
    const payload = await loadFixture('text-message.json');
    const event = await prisma.webhookEvent.create({ data: {
      tenantId, provider: 'META', externalEventId: `retry-${randomUUID()}`,
      payload: payload as Prisma.InputJsonObject,
    } });
    const processor = new InstagramProcessor(prisma, { copy }, { processIfTriggered });

    await expect(processor.process(tenantId, event.id)).rejects.toMatchObject({ code: 'P2034' });
    await expect(processor.process(tenantId, event.id)).resolves.toBe('PROCESSED');

    const message = await prisma.message.findFirstOrThrow({ where: { tenantId, externalMessageId: 'm_text_001' } });
    expect(processIfTriggered).toHaveBeenNthCalledWith(1, tenantId, message.id);
    expect(processIfTriggered).toHaveBeenNthCalledWith(2, tenantId, message.id);
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

    await processor.process(tenantId, event.id);

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

  it('classifies an ambiguous Instagram post as video from its copied MIME type', async () => {
    const sourceUrl = 'https://lookaside.instagram.test/video-source';
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'page',
        messaging: [{
          sender: { id: 'ig-video-customer' },
          recipient: { id: 'page' },
          timestamp: new Date('2026-09-24T12:00:00.000Z').getTime(),
          message: {
            mid: 'm_video_001',
            attachments: [{ type: 'ig_post', payload: { url: sourceUrl } }],
          },
        }],
      }],
    };
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'm_video_001', payload },
    });
    copy.mockResolvedValue({
      key: 'tenants/test/instagram/sha256/checksum.mp4',
      etag: 'etag',
      checksum: 'video-checksum',
      contentType: 'video/mp4',
    });

    const processor = new InstagramProcessor(prisma, { copy });
    await processor.process(tenantId, event.id);
    await processor.process(tenantId, event.id);

    await expect(prisma.attachment.findFirstOrThrow({ where: { originalUrl: sourceUrl } }))
      .resolves.toMatchObject({
        type: 'VIDEO',
        copyStatus: 'COPIED',
        storageKey: 'tenants/test/instagram/sha256/checksum.mp4',
      });
    await expect(prisma.attachment.count({ where: { originalUrl: sourceUrl } })).resolves.toBe(1);
  });

  it('recovers a legacy MP4 attachment that previously failed image-only validation', async () => {
    const sourceUrl = 'https://lookaside.instagram.test/legacy-video-source';
    const timestamp = new Date('2026-09-24T12:10:00.000Z');
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'page',
        messaging: [{
          sender: { id: 'ig-legacy-video-customer' },
          recipient: { id: 'page' },
          timestamp: timestamp.getTime(),
          message: {
            mid: 'm_legacy_video_001',
            attachments: [{ type: 'ig_post', payload: { url: sourceUrl } }],
          },
        }],
      }],
    };
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'm_legacy_video_001', payload },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-legacy-video-customer',
        participantId: 'ig-legacy-video-customer',
        lastMessageAt: timestamp,
      },
    });
    const message = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'm_legacy_video_001',
        direction: 'INBOUND',
        senderId: 'ig-legacy-video-customer',
        text: null,
        sourceTimestamp: timestamp,
      },
    });
    await prisma.attachment.create({
      data: {
        messageId: message.id,
        type: 'IMAGE',
        originalUrl: sourceUrl,
        copyStatus: 'FAILED',
        failureSummary: 'Media exceeds the configured byte ceiling',
      },
    });
    copy.mockResolvedValue({
      key: 'tenants/test/instagram/sha256/legacy-checksum.mp4',
      etag: 'etag',
      checksum: 'legacy-video-checksum',
      contentType: 'video/mp4',
    });

    await new InstagramProcessor(prisma, { copy }).process(tenantId, event.id);

    await expect(prisma.attachment.findFirstOrThrow({ where: { messageId: message.id } }))
      .resolves.toMatchObject({
        type: 'VIDEO',
        copyStatus: 'COPIED',
        failureSummary: null,
      });
  });

  it('backfills a shared link for an already durable message without retriggering AI', async () => {
    copy.mockReset();
    processIfTriggered.mockReset();
    const timestamp = new Date('2026-09-24T10:00:00.000Z');
    const payload = {
      object: 'instagram',
      entry: [{
        id: 'page',
        messaging: [{
          sender: { id: 'ig-link-backfill' },
          recipient: { id: 'page' },
          timestamp: timestamp.getTime(),
          message: {
            mid: 'm_link_backfill',
            attachments: [{ type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/fictional' } }],
          },
        }],
      }],
    };
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'm_link_backfill', payload },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-link-backfill',
        participantId: 'ig-link-backfill',
        lastMessageAt: timestamp,
      },
    });
    const message = await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'm_link_backfill',
        direction: 'INBOUND',
        senderId: 'ig-link-backfill',
        text: null,
        sourceTimestamp: timestamp,
      },
    });

    await new InstagramProcessor(prisma, { copy }, { processIfTriggered }).process(tenantId, event.id);
    await new InstagramProcessor(prisma, { copy }, { processIfTriggered }).process(tenantId, event.id);

    await expect(prisma.attachment.findFirstOrThrow({ where: { messageId: message.id } })).resolves.toMatchObject({
      type: 'LINK',
      originalUrl: 'https://www.instagram.com/reel/fictional',
      copyStatus: 'NOT_REQUIRED',
    });
    expect(await prisma.attachment.count({ where: { messageId: message.id } })).toBe(1);
    expect(copy).not.toHaveBeenCalled();
    expect(processIfTriggered).not.toHaveBeenCalled();
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

    await processor.process(tenantId, event.id);

    const message = await prisma.message.findUniqueOrThrow({
      where: {
        tenantId_channel_externalMessageId: {
          tenantId,
          channel: 'INSTAGRAM',
          externalMessageId: 'm_manager_confirmation',
        },
      },
    });
    expect(processIfTriggered).toHaveBeenCalledWith(tenantId, message.id);
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

    await new InstagramProcessor(prisma, { copy }).process(tenantId, event.id);

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

    await new InstagramProcessor(prisma, { copy }, { processIfTriggered }).process(tenantId, event.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
    await expect(prisma.message.findUniqueOrThrow({ where: { id: localId } })).resolves.toMatchObject({
      rawEventId: event.id,
      providerMessageId: 'mid.provider.123',
      deliveryStatus: 'SENT',
      deliveryErrorCode: null,
    });
    expect(processIfTriggered).toHaveBeenCalledOnce();
    expect(processIfTriggered).toHaveBeenCalledWith(tenantId, localId);
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

    await new InstagramProcessor(prisma, { copy }).process(tenantId, event.id);

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

    await new InstagramProcessor(prisma, { copy }).process(tenantId, event.id);

    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(3);
    await expect(prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, externalMessageId: 'mid.ambiguous.123' },
    })).resolves.toMatchObject({ rawEventId: event.id, providerMessageId: null });
  });

  it('marks a queued event processed without business writes when the tenant is frozen', async () => {
    const payload = await loadFixture('text-message.json');
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'm_frozen_worker_001', payload: payload as Prisma.InputJsonObject },
    });
    const admin = await prisma.user.create({
      data: { email: 'worker-lifecycle-admin@example.test', name: 'Worker Admin', status: 'ACTIVE', platformRole: 'PLATFORM_ADMIN' },
    });
    await prisma.tenantLifecycleRequest.create({ data: {
      tenantId, kind: 'DELETE', status: 'EXPORT_READY', reasonCode: 'ADMINISTRATIVE_TEST',
      requestedByUserId: admin.id, idempotencyKey: randomUUID(), requestHash: 'd'.repeat(64),
      ingestionFrozenAt: new Date(),
    } });
    const messagesBefore = await prisma.message.count({ where: { tenantId } });
    copy.mockClear();
    processIfTriggered.mockClear();

    await expect(new InstagramProcessor(prisma, { copy }, { processIfTriggered }).process(tenantId, event.id))
      .resolves.toBe('IGNORED_FROZEN');
    await expect(prisma.message.count({ where: { tenantId } })).resolves.toBe(messagesBefore);
    await expect(prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ status: 'PROCESSED', processedAt: expect.any(Date) });
    expect(copy).not.toHaveBeenCalled();
    expect(processIfTriggered).not.toHaveBeenCalled();
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
