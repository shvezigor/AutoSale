import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { TikTokBusinessMessagingError } from '@autosale/integrations';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TikTokMessageDeliveryService } from './tiktok-message-delivery.service.js';
import { TikTokMessageReconciler } from './tiktok-message-reconciler.js';

describe('TikTokMessageDeliveryService', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let tenantId: string;
  let conversationId: string;
  let generationId: string;
  const now = new Date('2026-10-04T09:00:00.000Z');
  const sendText = vi.fn();
  const getFreshAccessToken = vi.fn();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    await applyMigrations(connectionString);
    prisma = createPrismaClient(connectionString);
    tenantId = (await prisma.tenant.create({ data: { key: 'tiktok-delivery', name: 'Fictional TikTok Shop' } })).id;
    const conversation = await prisma.conversation.create({ data: {
      tenantId, channel: 'TIKTOK', externalConversationId: 'fictional-conversation',
      participantId: 'fictional-customer', lastMessageAt: now,
    } });
    conversationId = conversation.id;
    const inbound = await prisma.webhookEvent.create({ data: {
      tenantId, provider: 'TIKTOK', externalEventId: 'fictional-tiktok-inbound', payload: {},
    } });
    await prisma.message.create({ data: {
      tenantId, conversationId, rawEventId: inbound.id, channel: 'TIKTOK',
      externalMessageId: 'fictional-inbound-message', direction: 'INBOUND',
      senderId: 'fictional-customer', text: 'Вітаю', sourceTimestamp: now,
    } });
  }, 60_000);

  beforeEach(async () => {
    sendText.mockReset().mockResolvedValue({ messageId: `fictional-provider-${randomUUID()}` });
    getFreshAccessToken.mockReset().mockResolvedValue('fictional-fresh-access-token');
    generationId = randomUUID();
    await prisma.tikTokConnection.upsert({
      where: { tenantId },
      create: {
        tenantId, externalAccountId: 'fictional-business', status: 'ACTIVE',
        capabilities: { receiveMessages: true, sendText: true, sendImage: false },
        encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh',
        credentialGenerationId: generationId, tokenExpiresAt: new Date(now.getTime() + 60_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 86_400_000),
      },
      update: {
        externalAccountId: 'fictional-business', status: 'ACTIVE',
        capabilities: { receiveMessages: true, sendText: true, sendImage: false },
        encryptedAccessToken: 'encrypted-access', encryptedRefreshToken: 'encrypted-refresh',
        credentialGenerationId: generationId, tokenExpiresAt: new Date(now.getTime() + 60_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 86_400_000), lastErrorCode: null,
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('claims, refreshes, sends and records the provider message exactly once', async () => {
    const messageId = await seedMessage();

    const instagramWakeups = await prisma.$queryRaw<Array<{ message_id: string }>>`
      SELECT message_id FROM public.worker_due_instagram_messages(${now}, 100)
    `;
    expect(instagramWakeups).not.toContainEqual({ message_id: messageId });

    await expect(service().process({ tenantId, messageId })).resolves.toBe('SENT');

    expect(getFreshAccessToken).toHaveBeenCalledWith(tenantId, generationId, now);
    expect(sendText).toHaveBeenCalledWith({
      accessToken: 'fictional-fresh-access-token', accountId: 'fictional-business',
      conversationId: 'fictional-conversation', text: 'Ваше замовлення прийнято.',
    });
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'SENT', providerMessageId: expect.stringContaining('fictional-provider-'),
      deliveryAttempts: 1, deliveryLeaseId: null, deliveryErrorCode: null,
    });
    await expect(service().process({ tenantId, messageId })).resolves.toBe('IGNORED');
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('refuses a stale credential generation before contacting TikTok', async () => {
    const messageId = await seedMessage({ credentialGenerationId: randomUUID() });

    await expect(service().process({ tenantId, messageId })).resolves.toBe('FAILED');
    expect(getFreshAccessToken).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_RECONNECT_REQUIRED',
    });
  });

  it('rechecks outbound capability and the 48-hour reply window before sending', async () => {
    const unavailableId = await seedMessage();
    await prisma.tikTokConnection.update({
      where: { tenantId },
      data: { status: 'INBOUND_ONLY', capabilities: { receiveMessages: true, sendText: false, sendImage: false } },
    });
    await expect(service().process({ tenantId, messageId: unavailableId })).resolves.toBe('FAILED');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: unavailableId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_REPLY_NOT_PERMITTED',
    });

    await prisma.tikTokConnection.update({
      where: { tenantId },
      data: { status: 'ACTIVE', capabilities: { receiveMessages: true, sendText: true, sendImage: false } },
    });
    await prisma.message.updateMany({
      where: { tenantId, conversationId, direction: 'INBOUND' },
      data: { sourceTimestamp: new Date(now.getTime() - 49 * 60 * 60_000) },
    });
    const expiredId = await seedMessage();
    try {
      await expect(service().process({ tenantId, messageId: expiredId })).resolves.toBe('FAILED');
      await expect(prisma.message.findUniqueOrThrow({ where: { id: expiredId } })).resolves.toMatchObject({
        deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_REPLY_NOT_PERMITTED',
      });
      expect(sendText).not.toHaveBeenCalled();
    } finally {
      await prisma.message.updateMany({
        where: { tenantId, conversationId, direction: 'INBOUND' }, data: { sourceTimestamp: now },
      });
    }
  });

  it('schedules bounded retries only for an explicit provider rate limit', async () => {
    const retryId = await seedMessage();
    sendText.mockRejectedValueOnce(new TikTokBusinessMessagingError('MESSAGE_SEND', 429, 40100, 'fictional-request', true));
    await expect(service().process({ tenantId, messageId: retryId })).resolves.toBe('RETRY');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: retryId } })).resolves.toMatchObject({
      deliveryStatus: 'PENDING', deliveryAttempts: 1, deliveryErrorCode: 'TIKTOK_RATE_LIMITED',
      nextDeliveryAttemptAt: new Date(now.getTime() + 5_000),
    });

    const exhaustedId = await seedMessage({ deliveryAttempts: 4 });
    sendText.mockRejectedValueOnce(new TikTokBusinessMessagingError('MESSAGE_SEND', 429, 40100, 'fictional-request', true));
    await expect(service().process({ tenantId, messageId: exhaustedId })).resolves.toBe('FAILED');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: exhaustedId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryAttempts: 5, deliveryErrorCode: 'TIKTOK_RATE_LIMITED',
    });
  });

  it.each([
    ['transport timeout', new TikTokBusinessMessagingError('MESSAGE_SEND', null, null, null, true)],
    ['provider 5xx', new TikTokBusinessMessagingError('MESSAGE_SEND', 503, 51065, 'fictional-request', true)],
  ])('stores UNKNOWN and never retries an ambiguous %s', async (_name, failure) => {
    const messageId = await seedMessage();
    sendText.mockRejectedValueOnce(failure);
    await expect(service().process({ tenantId, messageId })).resolves.toBe('UNKNOWN');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
      deliveryStatus: 'UNKNOWN', deliveryErrorCode: 'TIKTOK_DELIVERY_UNKNOWN', nextDeliveryAttemptAt: null,
    });
  });

  it('distinguishes reconnect and conversation permission failures', async () => {
    const reconnectId = await seedMessage();
    sendText.mockRejectedValueOnce(new TikTokBusinessMessagingError('MESSAGE_SEND', 401, 40101, 'fictional-request', false));
    await expect(service().process({ tenantId, messageId: reconnectId })).resolves.toBe('FAILED');
    await expect(prisma.tikTokConnection.findUniqueOrThrow({ where: { tenantId } })).resolves.toMatchObject({
      status: 'REAUTH_REQUIRED', lastErrorCode: 'TIKTOK_RECONNECT_REQUIRED',
    });

    await prisma.tikTokConnection.update({ where: { tenantId }, data: { status: 'ACTIVE', lastErrorCode: null } });
    const permissionId = await seedMessage();
    sendText.mockRejectedValueOnce(new TikTokBusinessMessagingError('MESSAGE_SEND', 403, 40103, 'fictional-request', false));
    await expect(service().process({ tenantId, messageId: permissionId })).resolves.toBe('FAILED');
    await expect(prisma.message.findUniqueOrThrow({ where: { id: permissionId } })).resolves.toMatchObject({
      deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_REPLY_NOT_PERMITTED',
    });
  });

  it('does not contact TikTok after tenant deletion preparation freezes mutations', async () => {
    const messageId = await seedMessage();
    const user = await prisma.user.create({ data: {
      email: `fictional-freeze-${randomUUID()}@example.test`, name: 'Fictional Administrator', status: 'ACTIVE',
    } });
    const request = await prisma.tenantLifecycleRequest.create({ data: {
      tenantId, kind: 'DELETE', status: 'REQUESTED', reasonCode: 'ADMINISTRATIVE_TEST',
      requestedByUserId: user.id, idempotencyKey: randomUUID(), requestHash: randomUUID(),
      ingestionFrozenAt: now,
    } });
    try {
      await expect(service().process({ tenantId, messageId })).resolves.toBe('IGNORED_FROZEN');
      expect(sendText).not.toHaveBeenCalled();
      await expect(prisma.message.findUniqueOrThrow({ where: { id: messageId } })).resolves.toMatchObject({
        deliveryStatus: 'FAILED', deliveryErrorCode: 'TIKTOK_SEND_FAILED',
      });
    } finally {
      await prisma.tenantLifecycleRequest.delete({ where: { id: request.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('allows one active lease and never reclaims an expired SENDING attempt', async () => {
    const pendingId = await seedMessage();
    let release!: () => void;
    sendText.mockImplementationOnce(() => new Promise((resolveSend) => {
      release = () => resolveSend({ messageId: 'fictional-provider-competing' });
    }));
    const first = service().process({ tenantId, messageId: pendingId });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    await expect(service().process({ tenantId, messageId: pendingId })).resolves.toBe('IGNORED');
    release();
    await expect(first).resolves.toBe('SENT');

    const staleId = await seedMessage({
      deliveryStatus: 'SENDING', deliveryLeaseId: randomUUID(),
      deliveryLeaseExpiresAt: new Date(now.getTime() - 1_000),
    });
    await expect(service().process({ tenantId, messageId: staleId })).resolves.toBe('IGNORED');
    expect(sendText).toHaveBeenCalledTimes(1);

    const reconciler = new TikTokMessageReconciler(prisma, { add: vi.fn().mockResolvedValue(undefined) }, () => now);
    await expect(reconciler.reconcile()).resolves.toMatchObject({ markedUnknown: 1 });
    await expect(prisma.message.findUniqueOrThrow({ where: { id: staleId } })).resolves.toMatchObject({
      deliveryStatus: 'UNKNOWN', deliveryErrorCode: 'TIKTOK_DELIVERY_UNKNOWN',
      deliveryLeaseId: null, nextDeliveryAttemptAt: null,
    });
  });

  function service(): TikTokMessageDeliveryService {
    return new TikTokMessageDeliveryService(prisma, { sendText }, { getFreshAccessToken }, () => new Date(now));
  }

  async function seedMessage(overrides: {
    credentialGenerationId?: string;
    deliveryAttempts?: number;
    deliveryStatus?: 'PENDING' | 'SENDING';
    deliveryLeaseId?: string;
    deliveryLeaseExpiresAt?: Date;
  } = {}): Promise<string> {
    const id = randomUUID();
    await prisma.message.create({ data: {
      id, tenantId, conversationId, rawEventId: null, channel: 'TIKTOK',
      externalMessageId: `local:${id}`, direction: 'OUTBOUND', senderId: 'fictional-business',
      text: 'Ваше замовлення прийнято.', sourceTimestamp: now,
      clientIdempotencyKey: randomUUID(), deliveryStatus: overrides.deliveryStatus ?? 'PENDING',
      deliveryAttempts: overrides.deliveryAttempts ?? 0,
      deliveryLeaseId: overrides.deliveryLeaseId ?? null,
      deliveryLeaseExpiresAt: overrides.deliveryLeaseExpiresAt ?? null,
      deliveryCredentialGenerationId: overrides.credentialGenerationId ?? generationId,
      nextDeliveryAttemptAt: overrides.deliveryStatus === 'SENDING' ? null : now,
    } });
    return id;
  }
});

async function applyMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  const directory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .sort((left, right) => migrationOrderKey(left).localeCompare(migrationOrderKey(right)));
  for (const name of names) await pool.query(await readFile(resolve(directory, name, 'migration.sql'), 'utf8'));
  await pool.end();
}

function migrationOrderKey(name: string): string {
  return name === '20260828_meta_instagram_oauth' ? '20260828000000_meta_instagram_oauth' : name;
}
