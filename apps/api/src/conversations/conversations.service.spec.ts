import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, PlatformChannelDisabledError, type PrismaClient } from '@autosale/database';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationsService } from './conversations.service.js';

describe('ConversationsService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: ConversationsService;
  let tenantId: string;
  let otherTenantId: string;
  let actorUserId: string;
  let newestId: string;
  let usernameOnlyId: string;
  const queue = { add: vi.fn() };
  const channelGate = { assertEnabled: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    const migrationsPath = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const migrationNames = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => migrationOrderKey(left).localeCompare(migrationOrderKey(right)));
    for (const migrationName of migrationNames) {
      const sql = await readFile(
        resolve(migrationsPath, migrationName, 'migration.sql'),
        'utf8',
      );
      await pool.query(sql);
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({ data: { key: 'a', name: 'A' } });
    const otherTenant = await prisma.tenant.create({ data: { key: 'b', name: 'B' } });
    tenantId = tenant.id;
    otherTenantId = otherTenant.id;
    const actor = await prisma.user.create({
      data: { email: 'manager@example.com', name: 'Manager', status: 'ACTIVE' },
    });
    actorUserId = actor.id;
    await prisma.tenantMembership.create({
      data: { tenantId, userId: actorUserId, role: 'MANAGER', status: 'ACTIVE' },
    });
    await prisma.instagramConnection.create({
      data: {
        tenantId,
        externalAccountId: 'instagram-shop-account',
        status: 'ACTIVE',
        encryptedAccessToken: 'encrypted-token',
        tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    });
    service = new ConversationsService(prisma, queue, channelGate as never);

    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'seed-a', payload: {} },
    });
    const current = Date.now();
    const times = [
      new Date(current - 3_000),
      new Date(current - 2_000),
      new Date(current - 1_000),
    ];
    for (const [index, lastMessageAt] of times.entries()) {
      const profile = await prisma.instagramCustomerProfile.create({
        data: {
          tenantId,
          participantId: `user-${index}`,
          displayName: index === 2 ? 'Олена Коваль' : null,
          username: index === 2 ? 'olena.koval' : index === 1 ? 'username_only' : null,
          avatarStorageKey: index === 2 ? 'tenant-a/avatar.jpg' : null,
          avatarChecksum: index === 2 ? 'avatar-v1' : null,
          avatarContentType: index === 2 ? 'image/jpeg' : null,
          status: 'READY',
        },
      });
      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          channel: 'INSTAGRAM',
          externalConversationId: `user-${index}`,
          participantId: `user-${index}`,
          profileId: profile.id,
          displayName: index === 1 ? 'Застаріле ім’я' : null,
          lastMessageAt,
        },
      });
      await prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          rawEventId: event.id,
          channel: 'INSTAGRAM',
          externalMessageId: `message-${index}`,
          direction: 'INBOUND',
          senderId: `user-${index}`,
          text: `Повідомлення ${index}`,
          sourceTimestamp: lastMessageAt,
        },
      });
      if (index === 2) newestId = conversation.id;
      if (index === 1) usernameOnlyId = conversation.id;
    }
    await prisma.conversation.create({
      data: {
        tenantId: otherTenant.id,
        channel: 'INSTAGRAM',
        externalConversationId: 'foreign-user',
        participantId: 'foreign-user',
        lastMessageAt: new Date('2026-08-26T13:00:00.000Z'),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(() => {
    queue.add.mockReset().mockResolvedValue(undefined);
    channelGate.assertEnabled.mockReset().mockResolvedValue(undefined);
  });

  it('orders newest first, isolates the tenant, and paginates by cursor', async () => {
    const first = await service.list(tenantId, { limit: 2 });
    const second = await service.list(tenantId, { limit: 2, cursor: first.nextCursor! });

    expect(first.items.map((item) => item.lastMessagePreview)).toEqual([
      'Повідомлення 2',
      'Повідомлення 1',
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toMatchObject({
      participantName: 'Олена Коваль',
      participantUsername: 'olena.koval',
      participantAvatarUrl: expect.stringMatching(/^\/api\/media\/instagram-profiles\/.+\/avatar\?v=avatar-v1$/),
    });
    expect(first.items[1]).toMatchObject({
      participantName: null,
      participantUsername: 'username_only',
      participantAvatarUrl: null,
    });
    expect(second.items.map((item) => item.lastMessagePreview)).toEqual(['Повідомлення 0']);
    expect(second.items[0]).toMatchObject({
      participantName: null,
      participantUsername: null,
      participantAvatarUrl: null,
    });
    expect(second.nextCursor).toBeNull();
  });

  it('returns an ordered conversation detail without source object URLs', async () => {
    const detail = await service.detail(tenantId, newestId);

    expect(detail).toMatchObject({
      id: newestId,
      channel: 'INSTAGRAM',
      participantName: 'Олена Коваль',
      participantUsername: 'olena.koval',
      participantAvatarUrl: expect.stringContaining('/api/media/instagram-profiles/'),
      messages: [{ text: 'Повідомлення 2' }],
    });
  });

  it('lists Facebook conversations and keeps their reply capability read-only', async () => {
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: `facebook-test-${randomUUID()}`, payload: {} },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'FACEBOOK',
        externalConversationId: 'fictional-facebook-customer',
        participantId: 'fictional-facebook-customer',
        displayName: 'Клієнт Facebook',
        lastMessageAt: new Date(),
      },
    });
    await prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'FACEBOOK',
        externalMessageId: 'fictional-facebook-message',
        direction: 'INBOUND',
        senderId: 'fictional-facebook-customer',
        text: 'Тестове повідомлення Facebook',
        sourceTimestamp: new Date(),
      },
    });

    try {
      const list = await service.list(tenantId, { limit: 20 });
      const detail = await service.detail(tenantId, conversation.id);

      expect(list.items.find((item) => item.id === conversation.id)).toMatchObject({
        channel: 'FACEBOOK',
        participantName: 'Клієнт Facebook',
      });
      expect(detail).toMatchObject({
        channel: 'FACEBOOK',
        participantName: 'Клієнт Facebook',
        participantAvatarUrl: null,
        replyCapability: { enabled: false, reason: 'CHANNEL_READ_ONLY' },
      });
    } finally {
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.webhookEvent.delete({ where: { id: event.id } });
    }
  });

  it('lists TikTok attachments with a provider preview and requires a reply connection', async () => {
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'TIKTOK', externalEventId: `tiktok-test-${randomUUID()}`, payload: {} },
    });
    const conversation = await prisma.conversation.create({ data: {
      tenantId, channel: 'TIKTOK', externalConversationId: 'fictional-tiktok-customer',
      participantId: 'fictional-tiktok-customer', displayName: 'Клієнт TikTok', lastMessageAt: new Date(),
    } });
    const message = await prisma.message.create({ data: {
      tenantId, conversationId: conversation.id, rawEventId: event.id, channel: 'TIKTOK',
      externalMessageId: 'fictional-tiktok-message', direction: 'INBOUND',
      senderId: 'fictional-tiktok-customer', text: null, sourceTimestamp: new Date(),
    } });
    await prisma.attachment.create({ data: {
      messageId: message.id, type: 'IMAGE', originalUrl: 'tiktok-media:fictional', copyStatus: 'COPIED',
    } });

    try {
      const list = await service.list(tenantId, { limit: 20 });
      expect(list.items.find((item) => item.id === conversation.id)).toMatchObject({
        channel: 'TIKTOK', participantName: 'Клієнт TikTok', lastMessagePreview: '📷 TikTok',
      });
      await expect(service.detail(tenantId, conversation.id)).resolves.toMatchObject({
        channel: 'TIKTOK', participantUsername: null, participantAvatarUrl: null,
        replyCapability: { enabled: false, reason: 'NOT_CONNECTED' },
      });
    } finally {
      await prisma.attachment.deleteMany({ where: { messageId: message.id } });
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.webhookEvent.delete({ where: { id: event.id } });
    }
  });

  it('returns copied images and videos, safe shared links, and unsupported attachment placeholders', async () => {
    const message = await prisma.message.findFirstOrThrow({
      where: { tenantId, conversationId: newestId },
      orderBy: { sourceTimestamp: 'desc' },
    });
    await prisma.attachment.createMany({
      data: [
        { messageId: message.id, type: 'IMAGE', originalUrl: 'https://provider.test/photo.jpg', copyStatus: 'COPIED' },
        { messageId: message.id, type: 'VIDEO', originalUrl: 'https://provider.test/video.mp4', copyStatus: 'COPIED' },
        { messageId: message.id, type: 'LINK', originalUrl: 'https://www.instagram.com/reel/fictional', copyStatus: 'NOT_REQUIRED' },
        { messageId: message.id, type: 'UNSUPPORTED', originalUrl: 'instagram:template', copyStatus: 'NOT_REQUIRED' },
      ],
    });

    try {
      const detail = await service.detail(tenantId, newestId);
      expect(detail.messages.at(-1)?.attachments).toEqual([
        expect.objectContaining({ type: 'IMAGE', mediaUrl: expect.stringMatching(/^\/api\/media\//) }),
        expect.objectContaining({ type: 'VIDEO', mediaUrl: expect.stringMatching(/^\/api\/media\//) }),
        expect.objectContaining({ type: 'LINK', mediaUrl: 'https://www.instagram.com/reel/fictional' }),
        expect.objectContaining({ type: 'UNSUPPORTED', mediaUrl: null }),
      ]);
    } finally {
      await prisma.attachment.deleteMany({ where: { messageId: message.id } });
    }
  });

  it('prefers a current profile username over a stale legacy name in list and detail responses', async () => {
    const list = await service.list(tenantId, { limit: 20 });
    const summary = list.items.find((item) => item.id === usernameOnlyId);
    const detail = await service.detail(tenantId, usernameOnlyId);

    expect(summary).toMatchObject({ participantName: null, participantUsername: 'username_only' });
    expect(detail).toMatchObject({ participantName: null, participantUsername: 'username_only' });
  });

  it('treats foreign and unknown conversation ids as not found', async () => {
    const foreign = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: { not: tenantId } },
    });

    await expect(service.detail(tenantId, foreign.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.detail(tenantId, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates one durable outbound reply and replays the same idempotency key', async () => {
    const idempotencyKey = randomUUID();

    const first = await service.send(tenantId, actorUserId, newestId, {
      text: '  Вітаю  ',
      idempotencyKey,
    });
    const replay = await service.send(tenantId, actorUserId, newestId, {
      text: 'Вітаю',
      idempotencyKey,
    });

    expect(first).toMatchObject({
      direction: 'OUTBOUND',
      senderId: 'instagram-shop-account',
      text: 'Вітаю',
      delivery: { status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false },
    });
    expect(replay.id).toBe(first.id);
    await expect(prisma.message.count({
      where: { tenantId, clientIdempotencyKey: idempotencyKey },
    })).resolves.toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'instagram.message.send',
      { tenantId, messageId: first.id },
      { jobId: first.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  });

  it('atomically links a reviewed AI draft to one outbound message', async () => {
    const anchor = await prisma.message.findFirstOrThrow({
      where: { tenantId, conversationId: newestId, direction: 'INBOUND' },
    });
    const draft = await prisma.aiReplyDraft.create({ data: {
      tenantId, conversationId: newestId, anchorMessageId: anchor.id,
      createdByUserId: actorUserId, idempotencyKey: randomUUID(), status: 'READY',
      generatedText: 'Вітаю!', sourceSnapshot: [],
    } });
    const idempotencyKey = randomUUID();
    try {
      const first = await service.send(tenantId, actorUserId, newestId, {
        text: 'Вітаю, чим допомогти?', idempotencyKey, draftId: draft.id,
      });
      const replay = await service.send(tenantId, actorUserId, newestId, {
        text: 'Вітаю, чим допомогти?', idempotencyKey, draftId: draft.id,
      });
      expect(replay.id).toBe(first.id);
      await expect(prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: draft.id } })).resolves.toMatchObject({
        status: 'USED', finalText: 'Вітаю, чим допомогти?', outboundMessageId: first.id,
      });
      await expect(service.send(tenantId, actorUserId, newestId, {
        text: 'Інший текст', idempotencyKey: randomUUID(), draftId: draft.id,
      })).rejects.toBeInstanceOf(ConflictException);
      await expect(service.send(tenantId, actorUserId, newestId, {
        text: 'Вітаю, чим допомогти?', idempotencyKey,
      })).rejects.toBeInstanceOf(BadRequestException);
      await expect(prisma.message.count({ where: { tenantId, clientIdempotencyKey: idempotencyKey } })).resolves.toBe(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.aiReplyDraft.delete({ where: { id: draft.id } });
    }
  });

  it('rejects a stale draft without creating an outbound message', async () => {
    const anchor = await prisma.message.findFirstOrThrow({
      where: { tenantId, conversationId: newestId, direction: 'INBOUND' },
    });
    const draft = await prisma.aiReplyDraft.create({ data: {
      tenantId, conversationId: newestId, anchorMessageId: anchor.id,
      createdByUserId: actorUserId, idempotencyKey: randomUUID(), status: 'READY',
      sourceSnapshot: [],
    } });
    const newInbound = await prisma.message.create({ data: {
      tenantId, conversationId: newestId, rawEventId: anchor.rawEventId,
      channel: 'INSTAGRAM', externalMessageId: `fictional-new-inbound-${randomUUID()}`,
      direction: 'INBOUND', senderId: 'fictional-customer', text: 'Нове запитання',
      sourceTimestamp: new Date(Date.now() + 1_000),
    } });
    const idempotencyKey = randomUUID();
    try {
      await expect(service.send(tenantId, actorUserId, newestId, {
        text: 'Відповідь', idempotencyKey, draftId: draft.id,
      })).rejects.toBeInstanceOf(ConflictException);
      await expect(prisma.message.count({ where: { tenantId, clientIdempotencyKey: idempotencyKey } })).resolves.toBe(0);
    } finally {
      await prisma.aiReplyDraft.delete({ where: { id: draft.id } });
      await prisma.message.delete({ where: { id: newInbound.id } });
    }
  });

  it('accepts one idempotent TikTok reply and routes it to the TikTok worker', async () => {
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'TIKTOK', externalEventId: `tiktok-send-${randomUUID()}`, payload: {} },
    });
    const conversation = await prisma.conversation.create({ data: {
      tenantId, channel: 'TIKTOK', externalConversationId: `fictional-tiktok-conversation-${randomUUID()}`,
      participantId: 'fictional-tiktok-customer', displayName: 'Клієнт TikTok', lastMessageAt: new Date(),
    } });
    await prisma.message.create({ data: {
      tenantId, conversationId: conversation.id, rawEventId: event.id, channel: 'TIKTOK',
      externalMessageId: `fictional-tiktok-inbound-${randomUUID()}`, direction: 'INBOUND',
      senderId: 'fictional-tiktok-customer', text: 'Чи є товар?', sourceTimestamp: new Date(),
    } });
    const generationId = randomUUID();
    await prisma.tikTokConnection.create({ data: {
      tenantId, externalAccountId: `fictional-tiktok-business-${randomUUID()}`, status: 'ACTIVE',
      capabilities: { receiveMessages: true, sendText: true, sendImage: false },
      encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh',
      credentialGenerationId: generationId,
      tokenExpiresAt: new Date(Date.now() - 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    } });
    const idempotencyKey = randomUUID();

    try {
      const detail = await service.detail(tenantId, conversation.id);
      const first = await service.send(tenantId, actorUserId, conversation.id, {
        text: '  Ваше замовлення прийнято.  ', idempotencyKey,
      });
      const replay = await service.send(tenantId, actorUserId, conversation.id, {
        text: 'Ваше замовлення прийнято.', idempotencyKey,
      });

      expect(detail.replyCapability).toEqual({ enabled: true, reason: null });
      expect(first).toMatchObject({
        direction: 'OUTBOUND', senderId: expect.stringContaining('fictional-tiktok-business-'),
        text: 'Ваше замовлення прийнято.',
        delivery: { status: 'PENDING', attempts: 0, errorCode: null, retryAllowed: false },
      });
      expect(replay.id).toBe(first.id);
      await expect(prisma.message.count({ where: { tenantId, clientIdempotencyKey: idempotencyKey } })).resolves.toBe(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        'tiktok.message.send',
        { tenantId, messageId: first.id },
        { jobId: first.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
      const stored = await prisma.message.findUniqueOrThrow({ where: { id: first.id } });
      expect(stored.deliveryCredentialGenerationId).toBe(generationId);

      const beforeDisabledAttempt = await prisma.message.count({ where: { conversationId: conversation.id } });
      channelGate.assertEnabled.mockRejectedValueOnce(
        new PlatformChannelDisabledError('TIKTOK_BUSINESS_MESSAGING'),
      );
      await expect(service.send(tenantId, actorUserId, conversation.id, {
        text: 'Не має бути збережено', idempotencyKey: randomUUID(),
      })).rejects.toMatchObject({ message: 'TIKTOK_CHANNEL_DISABLED' });
      await expect(prisma.message.count({ where: { conversationId: conversation.id } }))
        .resolves.toBe(beforeDisabledAttempt);

      await prisma.message.updateMany({
        where: { tenantId, conversationId: conversation.id, direction: 'INBOUND' },
        data: { sourceTimestamp: new Date(Date.now() - 49 * 60 * 60_000) },
      });
      await expect(service.detail(tenantId, conversation.id)).resolves.toMatchObject({
        replyCapability: { enabled: false, reason: 'TIKTOK_REPLY_NOT_PERMITTED' },
      });
      await expect(service.send(tenantId, actorUserId, conversation.id, {
        text: 'Запізніла відповідь', idempotencyKey: randomUUID(),
      })).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.webhookEvent.delete({ where: { id: event.id } });
      await prisma.tikTokConnection.deleteMany({ where: { tenantId } });
    }
  });

  it('explains and rejects TikTok replies without outbound capability', async () => {
    const conversation = await prisma.conversation.create({ data: {
      tenantId, channel: 'TIKTOK', externalConversationId: `fictional-inbound-only-${randomUUID()}`,
      participantId: 'fictional-tiktok-customer', lastMessageAt: new Date(),
    } });
    await prisma.tikTokConnection.create({ data: {
      tenantId, externalAccountId: `fictional-inbound-only-business-${randomUUID()}`, status: 'INBOUND_ONLY',
      capabilities: { receiveMessages: true, sendText: false, sendImage: false },
      encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh',
      credentialGenerationId: randomUUID(), tokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    } });

    try {
      await expect(service.detail(tenantId, conversation.id)).resolves.toMatchObject({
        replyCapability: { enabled: false, reason: 'TIKTOK_CAPABILITY_UNAVAILABLE' },
      });
      await expect(service.send(tenantId, actorUserId, conversation.id, {
        text: 'Вітаю', idempotencyKey: randomUUID(),
      })).rejects.toBeInstanceOf(BadRequestException);
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.tikTokConnection.deleteMany({ where: { tenantId } });
    }
  });

  it('retries a safely rate-limited TikTok reply on the TikTok queue', async () => {
    const conversation = await prisma.conversation.create({ data: {
      tenantId, channel: 'TIKTOK', externalConversationId: `fictional-tiktok-retry-${randomUUID()}`,
      participantId: 'fictional-tiktok-customer', lastMessageAt: new Date(),
    } });
    const generationId = randomUUID();
    await prisma.tikTokConnection.create({ data: {
      tenantId, externalAccountId: `fictional-tiktok-retry-business-${randomUUID()}`, status: 'ACTIVE',
      capabilities: { receiveMessages: true, sendText: true, sendImage: false },
      encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh',
      credentialGenerationId: generationId, tokenExpiresAt: new Date(Date.now() + 60_000),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    } });
    const inboundEvent = await prisma.webhookEvent.create({ data: {
      tenantId, provider: 'TIKTOK', externalEventId: `fictional-tiktok-retry-event-${randomUUID()}`, payload: {},
    } });
    await prisma.message.create({ data: {
      tenantId, conversationId: conversation.id, rawEventId: inboundEvent.id, channel: 'TIKTOK',
      externalMessageId: `fictional-tiktok-retry-inbound-${randomUUID()}`, direction: 'INBOUND',
      senderId: 'fictional-tiktok-customer', text: 'Повторіть відповідь', sourceTimestamp: new Date(),
    } });
    const message = await prisma.message.create({ data: {
      tenantId, conversationId: conversation.id, rawEventId: null, channel: 'TIKTOK',
      externalMessageId: `local:${randomUUID()}`, direction: 'OUTBOUND', senderId: 'fictional-business',
      text: 'Повторити', sourceTimestamp: new Date(), clientIdempotencyKey: randomUUID(),
      sentByUserId: actorUserId, deliveryStatus: 'FAILED', deliveryAttempts: 1,
      deliveryErrorCode: 'TIKTOK_RATE_LIMITED',
      deliveryCredentialGenerationId: generationId,
    } });

    try {
      channelGate.assertEnabled.mockRejectedValueOnce(
        new PlatformChannelDisabledError('TIKTOK_BUSINESS_MESSAGING'),
      );
      await expect(service.retry(tenantId, actorUserId, conversation.id, message.id))
        .rejects.toMatchObject({ message: 'TIKTOK_CHANNEL_DISABLED' });
      await expect(prisma.message.findUniqueOrThrow({ where: { id: message.id } }))
        .resolves.toMatchObject({ deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_RATE_LIMITED' });

      const result = await service.retry(tenantId, actorUserId, conversation.id, message.id);
      expect(result.delivery).toEqual({ status: 'PENDING', attempts: 1, errorCode: null, retryAllowed: false });
      expect(queue.add).toHaveBeenCalledWith(
        'tiktok.message.send',
        { tenantId, messageId: message.id },
        { jobId: message.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
      );
    } finally {
      await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.webhookEvent.delete({ where: { id: inboundEvent.id } });
      await prisma.tikTokConnection.deleteMany({ where: { tenantId } });
    }
  });

  it('keeps an accepted reply durable when queue wake-up fails', async () => {
    queue.add.mockRejectedValueOnce(new Error('redis-details-that-must-not-leak'));
    const idempotencyKey = randomUUID();

    const sent = await service.send(tenantId, actorUserId, newestId, {
      text: 'Відповідь збережена',
      idempotencyKey,
    });

    expect(sent.delivery?.status).toBe('PENDING');
    await expect(prisma.message.findFirst({
      where: { tenantId, clientIdempotencyKey: idempotencyKey },
    })).resolves.toMatchObject({ id: sent.id, deliveryStatus: 'PENDING' });
  });

  it('does not expose a foreign conversation through send', async () => {
    const foreign = await prisma.conversation.findFirstOrThrow({
      where: { tenantId: otherTenantId },
    });

    await expect(service.send(tenantId, actorUserId, foreign.id, {
      text: 'Вітаю',
      idempotencyKey: randomUUID(),
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues AI recognition for the latest message when a manager creates an order manually', async () => {
    const latest = await prisma.message.findFirstOrThrow({
      where: { tenantId, conversationId: newestId },
      orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
    });

    const result = await service.createOrder(tenantId, newestId);

    expect(result).toEqual({ orderId: null, queued: true });
    expect(queue.add).toHaveBeenCalledWith(
      'instagram.order.create',
      { tenantId, triggerMessageId: latest.id },
      { jobId: `manual-order-${latest.id}`, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  });

  it('returns the existing latest order without queueing a duplicate recognition', async () => {
    const latest = await prisma.message.findFirstOrThrow({
      where: { tenantId, conversationId: newestId },
      orderBy: [{ sourceTimestamp: 'desc' }, { id: 'desc' }],
    });
    const existing = await prisma.order.create({
      data: {
        tenantId, conversationId: newestId, triggerMessageId: latest.id,
        status: 'AI_PROCESSING', promptVersion: 'instagram-order-v1',
      },
    });

    try {
      await expect(service.orderState(tenantId, newestId)).resolves.toEqual({
        order: { id: existing.id, status: 'AI_PROCESSING' },
      });
      await expect(service.createOrder(tenantId, newestId)).resolves.toEqual({
        orderId: existing.id, queued: false,
      });
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      await prisma.order.delete({ where: { id: existing.id } });
    }
  });

  it('blocks replies when the tenant Instagram connection requires authorization', async () => {
    await prisma.instagramConnection.update({
      where: { tenantId },
      data: { status: 'REAUTH_REQUIRED' },
    });
    try {
      await expect(service.send(tenantId, actorUserId, newestId, {
        text: 'Вітаю',
        idempotencyKey: randomUUID(),
      })).rejects.toBeInstanceOf(BadRequestException);
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      await prisma.instagramConnection.update({
        where: { tenantId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('disables and rejects replies when the customer has not written for more than 7 days', async () => {
    const staleConversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'stale-customer',
        participantId: 'stale-customer',
        lastMessageAt: new Date(Date.now() - (8 * 24 * 60 * 60 * 1_000)),
      },
    });
    const staleEvent = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: `stale-${randomUUID()}`, payload: {} },
    });
    await prisma.message.create({
      data: {
        tenantId,
        conversationId: staleConversation.id,
        rawEventId: staleEvent.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'stale-inbound-message',
        direction: 'INBOUND',
        senderId: 'stale-customer',
        text: 'Давнє повідомлення',
        sourceTimestamp: new Date(Date.now() - (8 * 24 * 60 * 60 * 1_000)),
      },
    });

    const detail = await service.detail(tenantId, staleConversation.id);
    expect(detail.replyCapability).toEqual({ enabled: false, reason: 'REPLY_WINDOW_EXPIRED' });
    await expect(service.send(tenantId, actorUserId, staleConversation.id, {
      text: 'Вітаю',
      idempotencyKey: randomUUID(),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('limits accepted replies to 30 per manager and tenant in a rolling minute', async () => {
    await prisma.message.deleteMany({
      where: { tenantId, sentByUserId: actorUserId, direction: 'OUTBOUND' },
    });
    const now = new Date();
    await prisma.message.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        tenantId,
        conversationId: newestId,
        rawEventId: null,
        channel: 'INSTAGRAM',
        externalMessageId: `local:${randomUUID()}`,
        direction: 'OUTBOUND',
        senderId: 'instagram-shop-account',
        text: `Reply ${index}`,
        sourceTimestamp: now,
        clientIdempotencyKey: randomUUID(),
        sentByUserId: actorUserId,
        deliveryStatus: 'PENDING' as const,
        nextDeliveryAttemptAt: now,
      })),
    });

    await expect(service.send(tenantId, actorUserId, newestId, {
      text: 'Вітаю',
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ status: 429 });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('retries only a safely retryable rate-limited reply', async () => {
    await prisma.message.deleteMany({
      where: { tenantId, sentByUserId: actorUserId, direction: 'OUTBOUND' },
    });
    const retryable = await prisma.message.create({
      data: {
        tenantId,
        conversationId: newestId,
        rawEventId: null,
        channel: 'INSTAGRAM',
        externalMessageId: `local:${randomUUID()}`,
        direction: 'OUTBOUND',
        senderId: 'instagram-shop-account',
        text: 'Повторити',
        sourceTimestamp: new Date(),
        clientIdempotencyKey: randomUUID(),
        sentByUserId: actorUserId,
        deliveryStatus: 'FAILED',
        deliveryAttempts: 1,
        deliveryErrorCode: 'INSTAGRAM_RATE_LIMITED',
      },
    });

    const result = await service.retry(tenantId, actorUserId, newestId, retryable.id);

    expect(result.delivery).toEqual({
      status: 'PENDING', attempts: 1, errorCode: null, retryAllowed: false,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'instagram.message.send',
      { tenantId, messageId: retryable.id },
      { jobId: retryable.id, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );

    await expect(service.retry(tenantId, actorUserId, newestId, retryable.id))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

function migrationOrderKey(name: string): string {
  return name === '20260828_meta_instagram_oauth' ? '20260828000000_meta_instagram_oauth' : name;
}
