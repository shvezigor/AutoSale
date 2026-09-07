import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    service = new ConversationsService(prisma, queue);

    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'seed-a', payload: {} },
    });
    const times = [
      new Date('2026-08-26T10:00:00.000Z'),
      new Date('2026-08-26T11:00:00.000Z'),
      new Date('2026-08-26T12:00:00.000Z'),
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
