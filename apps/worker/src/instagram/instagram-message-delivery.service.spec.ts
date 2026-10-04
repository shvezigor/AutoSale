import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { CredentialCipher, MetaInstagramError } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstagramMessageDeliveryService } from './instagram-message-delivery.service.js';

describe('InstagramMessageDeliveryService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  let conversationId: string;
  let actorUserId: string;
  const now = new Date('2026-09-07T12:00:00.000Z');
  const cipher = new CredentialCipher(Buffer.alloc(32, 9));
  const sendText = vi.fn();
  const processIfTriggered = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    await applyMigrations(connectionString);
    prisma = createPrismaClient(connectionString);
    const tenant = await prisma.tenant.create({ data: { key: 'delivery', name: 'Delivery' } });
    tenantId = tenant.id;
    const actor = await prisma.user.create({
      data: { email: 'instagram-manager@example.test', name: 'Instagram Manager', status: 'ACTIVE' },
    });
    actorUserId = actor.id;
    await prisma.instagramConnection.create({
      data: {
        tenantId,
        externalAccountId: 'instagram-shop',
        status: 'ACTIVE',
        encryptedAccessToken: cipher.encrypt('access-token-that-must-not-leak'),
        credentialGenerationId: randomUUID(),
        tokenExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-customer-1',
        participantId: 'ig-customer-1',
        lastMessageAt: now,
      },
    });
    conversationId = conversation.id;
    const event = await prisma.webhookEvent.create({
      data: { tenantId, provider: 'META', externalEventId: 'delivery-default-inbound', payload: {} },
    });
    await prisma.message.create({
      data: {
        tenantId,
        conversationId,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'default-inbound-message',
        direction: 'INBOUND',
        senderId: 'ig-customer-1',
        text: 'Вхідне повідомлення',
        sourceTimestamp: now,
      },
    });
  }, 60_000);

  beforeEach(() => {
    sendText.mockReset().mockImplementation(async () => ({
      recipientId: 'ig-customer-1',
      messageId: `mid.${randomUUID()}`,
    }));
    processIfTriggered.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('claims, decrypts, sends, fences completion, and triggers order processing', async () => {
    const messageId = await seedMessage();

    await expect(service().process({ tenantId, messageId })).resolves.toBe('SENT');

    expect(sendText).toHaveBeenCalledWith(
      'instagram-shop', 'ig-customer-1', 'Вітаю', 'access-token-that-must-not-leak',
    );
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'SENT',
      providerMessageId: expect.stringMatching(/^mid\./),
      deliveryAttempts: 1,
      deliveryLeaseId: null,
      deliveryErrorCode: null,
    });
    expect(processIfTriggered).toHaveBeenCalledWith(tenantId, messageId);
  });

  it('uses the human-agent tag only for a manager reply sent 24 hours to 7 days after the last inbound message', async () => {
    await prisma.message.updateMany({
      where: { tenantId, conversationId, direction: 'INBOUND' },
      data: { sourceTimestamp: new Date(now.getTime() - (4 * 24 * 60 * 60 * 1_000)) },
    });
    const messageId = await seedMessage({ sentByUserId: actorUserId });

    try {
      await expect(service().process({ tenantId, messageId })).resolves.toBe('SENT');
      expect(sendText).toHaveBeenCalledWith(
        'instagram-shop', 'ig-customer-1', 'Вітаю', 'access-token-that-must-not-leak',
        { humanAgent: true },
      );
    } finally {
      await prisma.message.updateMany({
        where: { tenantId, conversationId, direction: 'INBOUND' },
        data: { sourceTimestamp: now },
      });
    }
  });

  it('does not call Meta when the last inbound message is older than 7 days', async () => {
    await prisma.message.updateMany({
      where: { tenantId, conversationId, direction: 'INBOUND' },
      data: { sourceTimestamp: new Date(now.getTime() - (8 * 24 * 60 * 60 * 1_000)) },
    });
    const messageId = await seedMessage();

    try {
      await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');
      expect(sendText).not.toHaveBeenCalled();
      await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
        deliveryStatus: 'FAILED', deliveryErrorCode: 'INSTAGRAM_REPLY_WINDOW_EXPIRED',
      });
    } finally {
      await prisma.message.updateMany({
        where: { tenantId, conversationId, direction: 'INBOUND' },
        data: { sourceTimestamp: now },
      });
    }
  });

  it('reports when Meta has not enabled extended-window manual replies', async () => {
    await prisma.message.updateMany({
      where: { tenantId, conversationId, direction: 'INBOUND' },
      data: { sourceTimestamp: new Date(now.getTime() - (4 * 24 * 60 * 60 * 1_000)) },
    });
    const messageId = await seedMessage({ sentByUserId: actorUserId });
    sendText.mockRejectedValueOnce(new MetaInstagramError(403, 10, false, 2018278, 'SEND'));

    try {
      await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');
      await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
        deliveryStatus: 'FAILED', deliveryErrorCode: 'INSTAGRAM_HUMAN_AGENT_UNAVAILABLE',
      });
    } finally {
      await prisma.message.updateMany({
        where: { tenantId, conversationId, direction: 'INBOUND' },
        data: { sourceTimestamp: now },
      });
    }
  });

  it('marks an invalid token as reconnect-required for the same credential generation', async () => {
    const messageId = await seedMessage();
    sendText.mockRejectedValueOnce(new MetaInstagramError(400, 190, false, 463, 'SEND'));

    await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');

    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'INSTAGRAM_RECONNECT_REQUIRED', deliveryLeaseId: null,
    });
    await expect(prisma.instagramConnection.findUniqueOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      status: 'REAUTH_REQUIRED', lastErrorCode: 'INSTAGRAM_RECONNECT_REQUIRED',
    });
    await prisma.instagramConnection.update({
      where: { tenantId },
      data: { status: 'ACTIVE', lastErrorCode: null },
    });
  });

  it.each([
    ['recipient restriction', 10, 2018108],
    ['message permission rejection', 200, null],
  ])('keeps a valid connection active after a %s', async (_reason, providerCode, errorSubcode) => {
    const messageId = await seedMessage();
    sendText.mockRejectedValueOnce(new MetaInstagramError(403, providerCode, false, errorSubcode, 'SEND'));

    await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');

    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'INSTAGRAM_SEND_FAILED', deliveryLeaseId: null,
    });
    await expect(prisma.instagramConnection.findUniqueOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      status: 'ACTIVE', lastErrorCode: null,
    });
  });

  it('schedules bounded retries for explicit rate limiting and stops after five attempts', async () => {
    const retryId = await seedMessage();
    sendText.mockRejectedValueOnce(new MetaInstagramError(429, 4, true, null, 'SEND'));

    await expect(service().process({ tenantId, messageId: retryId })).resolves.toBe('RETRY');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: retryId } })).resolves.toMatchObject({
      deliveryStatus: 'PENDING', deliveryAttempts: 1, deliveryErrorCode: 'INSTAGRAM_RATE_LIMITED',
      nextDeliveryAttemptAt: new Date(now.getTime() + 5_000),
    });

    const exhaustedId = await seedMessage({ deliveryAttempts: 4 });
    sendText.mockRejectedValueOnce(new MetaInstagramError(429, 4, true, null, 'SEND'));
    await expect(service().process({ tenantId, messageId: exhaustedId })).resolves.toBe('FAILED');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: exhaustedId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryAttempts: 5, deliveryErrorCode: 'INSTAGRAM_RATE_LIMITED',
      nextDeliveryAttemptAt: null,
    });
  });

  it.each([
    ['transport timeout', new MetaInstagramError(null, null, null, null, 'SEND')],
    ['ambiguous provider 5xx', new MetaInstagramError(503, 2, true, null, 'SEND')],
  ])('stores UNKNOWN without retry after %s', async (_name, failure) => {
    const messageId = await seedMessage();
    sendText.mockRejectedValueOnce(failure);

    await expect(service().process({ tenantId, messageId })).resolves.toBe('UNKNOWN');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'UNKNOWN', deliveryErrorCode: 'INSTAGRAM_DELIVERY_UNKNOWN',
      nextDeliveryAttemptAt: null, deliveryLeaseId: null,
    });
    expect(processIfTriggered).not.toHaveBeenCalled();
  });

  it('stores a controlled permanent failure', async () => {
    const messageId = await seedMessage();
    sendText.mockRejectedValueOnce(new MetaInstagramError(400, 100, false, null, 'SEND'));

    await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'INSTAGRAM_SEND_FAILED', nextDeliveryAttemptAt: null,
    });
  });

  it('allows only one competing worker to send a claimed message', async () => {
    const messageId = await seedMessage();
    let release!: () => void;
    sendText.mockImplementationOnce(() => new Promise((resolveSend) => {
      release = () => resolveSend({ recipientId: 'ig-customer-1', messageId: 'mid.competing' });
    }));

    const first = service().process({ tenantId, messageId });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const second = await service().process({ tenantId, messageId });
    release();

    await expect(first).resolves.toBe('SENT');
    expect(second).toBe('IGNORED');
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('never claims an outbound message owned by another social channel', async () => {
    const messageId = await seedMessage({ channel: 'TIKTOK' });

    await expect(service().process({ tenantId, messageId })).resolves.toBe('IGNORED');
    expect(sendText).not.toHaveBeenCalled();
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'PENDING', deliveryAttempts: 0,
    });
  });

  function service(): InstagramMessageDeliveryService {
    return new InstagramMessageDeliveryService(
      prisma,
      { sendText },
      cipher,
      { processIfTriggered },
      () => new Date(now),
    );
  }

  async function seedMessage(overrides: {
    deliveryAttempts?: number;
    sentByUserId?: string;
    channel?: 'INSTAGRAM' | 'TIKTOK';
  } = {}): Promise<string> {
    const id = randomUUID();
    await prisma.message.create({
      data: {
        id,
        tenantId,
        conversationId,
        rawEventId: null,
        channel: overrides.channel ?? 'INSTAGRAM',
        externalMessageId: `local:${id}`,
        direction: 'OUTBOUND',
        senderId: 'instagram-shop',
        text: 'Вітаю',
        sourceTimestamp: now,
        clientIdempotencyKey: randomUUID(),
        sentByUserId: overrides.sentByUserId ?? null,
        deliveryStatus: 'PENDING',
        deliveryAttempts: overrides.deliveryAttempts ?? 0,
        nextDeliveryAttemptAt: now,
      },
    });
    return id;
  }
});

async function applyMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  const directory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => migrationOrderKey(left).localeCompare(migrationOrderKey(right)));
  for (const name of names) {
    await pool.query(await readFile(resolve(directory, name, 'migration.sql'), 'utf8'));
  }
  await pool.end();
}

function migrationOrderKey(name: string): string {
  return name === '20260828_meta_instagram_oauth' ? '20260828000000_meta_instagram_oauth' : name;
}
