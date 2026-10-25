import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OpenAiReplyDraftGenerator } from '../../../worker/src/reply-drafts/openai-reply-draft-generator.js';
import { ReplyDraftProcessor } from '../../../worker/src/reply-drafts/reply-draft.processor.js';
import { ConversationsService } from './conversations.service.js';

describe('AI provider failure across worker and conversation API', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    const migrationsPath = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    const migrations = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => migrationOrderKey(left).localeCompare(migrationOrderKey(right)));
    for (const name of migrations) {
      await pool.query(await readFile(resolve(migrationsPath, name, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('persists one safe failure and shows it in conversation detail without sending', async () => {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional shop' } });
    await prisma.tenantReplyStyle.create({ data: {
      tenantId: tenant.id, enabled: true, companyName: 'Fictional shop',
    } });
    await prisma.instagramConnection.create({ data: {
      tenantId: tenant.id, externalAccountId: 'fictional-instagram-shop', status: 'ACTIVE',
      encryptedAccessToken: 'fictional-encrypted-token', tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } });
    const conversation = await prisma.conversation.create({ data: {
      tenantId: tenant.id, channel: 'INSTAGRAM', externalConversationId: randomUUID(),
      participantId: 'fictional-customer', lastMessageAt: new Date(),
    } });
    const event = await prisma.webhookEvent.create({ data: {
      tenantId: tenant.id, provider: 'META', externalEventId: randomUUID(), payload: {},
    } });
    const anchor = await prisma.message.create({ data: {
      tenantId: tenant.id, conversationId: conversation.id, rawEventId: event.id,
      channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
      senderId: 'fictional-customer', text: 'DOOR-7?', sourceTimestamp: new Date(),
    } });
    await prisma.product.create({ data: {
      tenantId: tenant.id, sku: 'DOOR-7', name: 'Fictional door', aliases: [],
      price: '1500.00', currency: 'UAH', stockQuantity: 3,
    } });
    const draft = await prisma.aiReplyDraft.create({ data: {
      tenantId: tenant.id, conversationId: conversation.id, anchorMessageId: anchor.id,
      createdByUserId: null, idempotencyKey: anchor.id, triggerSource: 'AUTOMATIC',
    } });
    const create = vi.fn().mockRejectedValue(new Error('fictional private provider details'));
    const generator = new OpenAiReplyDraftGenerator({ create }, 'fictional-model');
    const processor = new ReplyDraftProcessor(prisma, generator);

    expect(await processor.process({ tenantId: tenant.id, draftId: draft.id })).toBe('FAILED');
    expect(await processor.process({ tenantId: tenant.id, draftId: draft.id })).toBe('SKIPPED');
    expect(create).toHaveBeenCalledOnce();
    await expect(prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: draft.id } })).resolves.toMatchObject({
      status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE', attempts: 1,
      generatedText: null, outboundMessageId: null,
    });

    const queue = { add: vi.fn() };
    const channelGate = { assertEnabled: vi.fn() };
    const detail = await new ConversationsService(prisma, queue as never, channelGate as never)
      .detail(tenant.id, conversation.id);
    expect(detail.replyDrafts?.find((item) => item.id === draft.id)).toMatchObject({
      triggerSource: 'AUTOMATIC', status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE',
      generatedText: null, finalText: null,
    });
    expect(detail.replyDrafts?.find((item) => item.id === draft.id)?.sources)
      .toEqual([expect.objectContaining({ sku: 'DOOR-7', name: 'Fictional door' })]);
    expect(detail.replyCapability).toMatchObject({ enabled: true });
    expect(JSON.stringify(detail)).not.toContain('fictional private provider details');
    await expect(prisma.message.count({ where: {
      tenantId: tenant.id, conversationId: conversation.id, direction: 'OUTBOUND',
    } })).resolves.toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

function migrationOrderKey(name: string): string {
  return name === '20260828_meta_instagram_oauth' ? '20260828000000_meta_instagram_oauth' : name;
}
