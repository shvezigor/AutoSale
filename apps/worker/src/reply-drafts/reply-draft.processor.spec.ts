import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ReplyDraftProcessor } from './reply-draft.processor.js';
import { ReplyModelInvalidResponseError } from './openai-reply-draft-generator.js';

describe('ReplyDraftProcessor', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const name of (await readdir(root)).sort()) {
      if (name !== 'migration_lock.toml') await pool.query(await readFile(resolve(root, name, 'migration.sql'), 'utf8'));
    }
    await pool.end();
    prisma = createPrismaClient(container.getConnectionUri());
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function seed() {
    const tenant = await prisma.tenant.create({ data: { key: randomUUID(), name: 'Fictional shop' } });
    const actor = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: 'Fictional manager', status: 'ACTIVE' } });
    await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: actor.id, role: 'MANAGER', status: 'ACTIVE' } });
    await prisma.tenantReplyStyle.create({ data: { tenantId: tenant.id, enabled: true, companyName: 'Fictional shop' } });
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
    const product = await prisma.product.create({ data: {
      tenantId: tenant.id, sku: 'DOOR-7', name: 'Fictional door', aliases: [], price: '1500.00',
      currency: 'UAH', stockQuantity: 0,
    } });
    const draft = await prisma.aiReplyDraft.create({ data: {
      tenantId: tenant.id, conversationId: conversation.id, anchorMessageId: anchor.id,
      createdByUserId: actor.id, idempotencyKey: randomUUID(),
    } });
    return { tenantId: tenant.id, conversationId: conversation.id, anchorId: anchor.id, productId: product.id, draftId: draft.id, eventId: event.id };
  }

  function generator(productId: string) {
    return vi.fn().mockResolvedValue({
      reply: { outcome: 'ANSWER', text: 'DOOR-7', productIds: [productId], claims: [
        { start: 0, end: 6, text: 'DOOR-7', type: 'SKU', field: 'sku', productId },
      ] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });
  }

  it('stores one grounded ready draft and does not spend twice', async () => {
    const seedData = await seed();
    const generate = generator(seedData.productId);
    const processor = new ReplyDraftProcessor(prisma, { generate });
    expect(await processor.process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    expect(await processor.process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('SKIPPED');
    expect(generate).toHaveBeenCalledOnce();
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'READY', generatedText: 'DOOR-7', modelVersion: 'fictional-model', attempts: 1,
    });
  });

  it('does not claim or spend an automatic draft before its quiet period ends', async () => {
    const seedData = await seed();
    const availableAt = new Date('2026-10-05T12:00:10.000Z');
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', availableAt, createdByUserId: null },
    });
    const generate = generator(seedData.productId);

    expect(await new ReplyDraftProcessor(
      prisma,
      { generate },
      () => new Date('2026-10-05T12:00:09.999Z'),
    ).process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('DEFERRED');
    expect(generate).not.toHaveBeenCalled();
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } }))
      .toMatchObject({ status: 'QUEUED', attempts: 0, availableAt });
  });

  it('marks a changed product stale after model generation', async () => {
    const seedData = await seed();
    const generate = generator(seedData.productId).mockImplementation(async () => {
      await prisma.product.update({ where: { id: seedData.productId }, data: { price: '1600.00' } });
      return { reply: { outcome: 'CLARIFY', text: 'Яку модель?', productIds: [], claims: [] },
        metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 } };
    });
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('STALE');
  });

  it('fails a provider exception without an automatic second call', async () => {
    const seedData = await seed();
    const generate = vi.fn().mockRejectedValue(new Error('fictional private provider failure'));
    const processor = new ReplyDraftProcessor(prisma, { generate });
    expect(await processor.process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('FAILED');
    expect(await processor.process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('SKIPPED');
    expect(generate).toHaveBeenCalledOnce();
    expect((await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it('marks the draft stale if a new customer message arrives during generation', async () => {
    const seedData = await seed();
    const generate = generator(seedData.productId).mockImplementation(async () => {
      await prisma.message.create({ data: {
        tenantId: seedData.tenantId, conversationId: seedData.conversationId, rawEventId: seedData.eventId,
        channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
        senderId: 'fictional-customer', text: 'Another fictional question',
        sourceTimestamp: new Date(Date.now() + 60_000),
      } });
      return { reply: { outcome: 'CLARIFY', text: 'Яку модель?', productIds: [], claims: [] },
        metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 } };
    });
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('STALE');
  });

  it('blocks an ungrounded model response without exposing its text', async () => {
    const seedData = await seed();
    const generate = vi.fn().mockResolvedValue({
      reply: { outcome: 'ANSWER', text: 'Знижка 50%', productIds: [], claims: [] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('BLOCKED');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'BLOCKED', generatedText: null, errorCode: 'UNGROUNDED_CLAIM',
    });
  });

  it('replaces an ungrounded automatic response with a fact-free clarification', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null },
    });
    await prisma.message.update({
      where: { id: seedData.anchorId },
      data: { text: 'Добрий день, ви двері продаєте?' },
    });
    const generate = vi.fn().mockResolvedValue({
      reply: {
        outcome: 'ANSWER',
        text: 'Так, ми продаємо двері. Яка модель вас цікавить?',
        productIds: [seedData.productId],
        claims: [{
          start: 17, end: 22, text: 'двері', type: 'NAME', field: 'name',
          productId: seedData.productId,
        }],
      },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'READY', outcome: 'CLARIFY',
      generatedText: 'Уточніть, будь ласка, який саме товар або модель вас цікавить.',
      errorCode: null,
    });
  });

  it('replaces an invalid automatic model response with a fact-free clarification', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null },
    });
    await prisma.message.update({
      where: { id: seedData.anchorId },
      data: { text: 'Добрий день, ви двері продаєте?' },
    });
    const generate = vi.fn().mockRejectedValue(new ReplyModelInvalidResponseError());

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'READY', outcome: 'CLARIFY', modelVersion: 'safe-fallback',
      generatedText: 'Уточніть, будь ласка, який саме товар або модель вас цікавить.',
      errorCode: null,
    });
  });

  it('does not call the model after the owner disables drafting', async () => {
    const seedData = await seed();
    await prisma.tenantReplyStyle.update({ where: { tenantId: seedData.tenantId }, data: { enabled: false } });
    const generate = generator(seedData.productId);
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('SKIPPED');
    expect(generate).not.toHaveBeenCalled();
    expect((await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).status).toBe('BLOCKED');
  });
});
