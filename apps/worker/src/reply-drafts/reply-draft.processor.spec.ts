import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ReplyDraftProcessor } from './reply-draft.processor.js';
import { ReplyModelInvalidResponseError } from './openai-reply-draft-generator.js';
import { CatalogueRetrievalError } from './catalogue-retrieval.js';

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

  it('keeps the draft ready if only a later attachment-only message arrives during generation', async () => {
    const seedData = await seed();
    const generate = generator(seedData.productId).mockImplementation(async () => {
      await prisma.message.create({ data: {
        tenantId: seedData.tenantId, conversationId: seedData.conversationId, rawEventId: seedData.eventId,
        channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
        senderId: 'fictional-customer', text: null,
        sourceTimestamp: new Date(Date.now() + 60_000),
      } });
      return {
        reply: { outcome: 'CLARIFY', text: 'Яку модель?', productIds: [], claims: [] },
        metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
      };
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
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

  it('offers exact catalogue variants when an automatic answer for a requested model is unsafe', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null },
    });
    await prisma.message.create({ data: {
      tenantId: seedData.tenantId, conversationId: seedData.conversationId, rawEventId: seedData.eventId,
      channel: 'INSTAGRAM', externalMessageId: randomUUID(), direction: 'INBOUND',
      senderId: 'fictional-customer', text: 'А які варіанти дверей можете запропонувати?',
      sourceTimestamp: new Date('2026-10-05T09:59:00.000Z'),
    } });
    await prisma.message.update({
      where: { id: seedData.anchorId },
      data: { text: 'Які ще моделі дверей Регіон можете показати?', sourceTimestamp: new Date('2026-10-05T10:00:00.000Z') },
    });
    await prisma.product.update({
      where: { id: seedData.productId },
      data: { sku: 'REGION-860', name: '860х2050 Регіон (плівка мат)' },
    });
    const second = await prisma.product.create({ data: {
      tenantId: seedData.tenantId, sku: 'REGION-960', name: '960х2050 Регіон VINARIT',
      aliases: [], price: null, currency: null, stockQuantity: null,
    } });
    await prisma.product.create({ data: {
      tenantId: seedData.tenantId, sku: 'LOCK-REGION', name: 'Додатковий замок (Регіон, Колізей)',
      aliases: [], price: null, currency: null, stockQuantity: null,
    } });
    const generate = vi.fn().mockResolvedValue({
      reply: { outcome: 'ANSWER', text: 'Знижка 50%', productIds: [seedData.productId, second.id], claims: [] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'READY', outcome: 'ANSWER',
      generatedText: [
        'Можу запропонувати такі варіанти:',
        '• 860х2050 Регіон (плівка мат)',
        '• 960х2050 Регіон VINARIT',
        'Який варіант вам підходить?',
      ].join('\n'),
      errorCode: null,
    });
  });

  it('offers only confirmed-stock variants after an availability question when the model response is unsafe', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null },
    });
    await prisma.message.update({
      where: { id: seedData.anchorId },
      data: { text: 'Які варіанти дверей Регіон є в наявності?' },
    });
    await prisma.product.update({
      where: { id: seedData.productId },
      data: { sku: 'TEST-REGION-860', name: '860х2050 Вигаданий Регіон А', stockQuantity: 3 },
    });
    await prisma.product.create({ data: {
      tenantId: seedData.tenantId, sku: 'TEST-REGION-960', name: '960х2050 Вигаданий Регіон Б',
      aliases: [], price: null, currency: null, stockQuantity: null,
    } });
    const generate = vi.fn().mockResolvedValue({
      reply: { outcome: 'ANSWER', text: 'Знижка 50%', productIds: [], claims: [] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    const draft = await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } });
    expect(draft).toMatchObject({ status: 'READY', outcome: 'ANSWER' });
    expect(draft.generatedText).toContain('860х2050 Вигаданий Регіон А');
    expect(draft.generatedText).not.toContain('960х2050 Вигаданий Регіон Б');
  });

  it('replaces a grounded model option list that offers an unknown-stock variant as available', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({
      where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null },
    });
    await prisma.message.update({
      where: { id: seedData.anchorId },
      data: { text: 'Які варіанти дверей Регіон є в наявності?' },
    });
    await prisma.product.update({
      where: { id: seedData.productId },
      data: { sku: 'TEST-REGION-860', name: '860х2050 Вигаданий Регіон А', stockQuantity: 3 },
    });
    const unknown = await prisma.product.create({ data: {
      tenantId: seedData.tenantId, sku: 'TEST-REGION-960', name: '960х2050 Вигаданий Регіон Б',
      aliases: [], price: null, currency: null, stockQuantity: null,
    } });
    const firstName = '860х2050 Вигаданий Регіон А';
    const secondName = '960х2050 Вигаданий Регіон Б';
    const text = `${firstName}\n${secondName}`;
    const generate = vi.fn().mockResolvedValue({
      reply: {
        outcome: 'ANSWER', text, productIds: [seedData.productId, unknown.id],
        claims: [
          { start: 0, end: firstName.length, text: firstName, type: 'NAME', field: 'name', productId: seedData.productId },
          { start: firstName.length + 1, end: text.length, text: secondName, type: 'NAME', field: 'name', productId: unknown.id },
        ],
      },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    const draft = await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } });
    expect(draft.generatedText).toContain('860х2050 Вигаданий Регіон А');
    expect(draft.generatedText).not.toContain('960х2050 Вигаданий Регіон Б');
  });

  it('answers a stock question without an options keyword from a confirmed-stock variant', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({ where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null } });
    await prisma.message.update({ where: { id: seedData.anchorId },
      data: { text: 'Що з дверей Регіон є в наявності?' } });
    await prisma.product.update({ where: { id: seedData.productId },
      data: { sku: 'TEST-REGION-860', name: '860х2050 Вигаданий Регіон А', stockQuantity: 3 } });
    const generate = vi.fn().mockRejectedValue(new ReplyModelInvalidResponseError());

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    const draft = await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } });
    expect(draft.outcome).toBe('ANSWER');
    expect(draft.generatedText).toContain('860х2050 Вигаданий Регіон А — в наявності');
  });

  it('asks for a stock check rather than offering zero- or unknown-stock variants', async () => {
    const seedData = await seed();
    await prisma.aiReplyDraft.update({ where: { id: seedData.draftId },
      data: { triggerSource: 'AUTOMATIC', createdByUserId: null } });
    await prisma.message.update({ where: { id: seedData.anchorId },
      data: { text: 'Які варіанти дверей Регіон є в наявності?' } });
    await prisma.product.update({ where: { id: seedData.productId },
      data: { sku: 'TEST-REGION-860', name: '860х2050 Вигаданий Регіон А', stockQuantity: 0 } });
    await prisma.product.create({ data: {
      tenantId: seedData.tenantId, sku: 'TEST-REGION-960', name: '960х2050 Вигаданий Регіон Б',
      aliases: [], price: null, currency: null, stockQuantity: null,
    } });
    const generate = vi.fn().mockRejectedValue(new ReplyModelInvalidResponseError());

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    const draft = await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } });
    expect(draft.outcome).toBe('CLARIFY');
    expect(draft.generatedText).toContain('потрібно додатково перевірити залишок');
    expect(draft.generatedText).not.toContain('Регіон');
  });

  it('blocks a manual AI retry that offers a zero-stock product in response to a stock question', async () => {
    const seedData = await seed();
    await prisma.message.update({ where: { id: seedData.anchorId },
      data: { text: 'Чи є DOOR-7 в наявності?' } });
    const generate = generator(seedData.productId);

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('BLOCKED');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'BLOCKED', generatedText: null, errorCode: 'UNGROUNDED_CLAIM',
    });
  });

  it('keeps a fact-free manual clarification for a stock question', async () => {
    const seedData = await seed();
    await prisma.message.update({ where: { id: seedData.anchorId },
      data: { text: 'Чи є DOOR-7 в наявності?' } });
    const generate = vi.fn().mockResolvedValue({
      reply: { outcome: 'CLARIFY', text: 'Я уточню залишок.', productIds: [], claims: [] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });

    expect(await new ReplyDraftProcessor(prisma, { generate })
      .process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('READY');
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'READY', outcome: 'CLARIFY', generatedText: 'Я уточню залишок.',
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

  it('grounds a draft in a product beyond the old 2,000-SKU prefix', async () => {
    const seedData = await seed();
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${seedData.tenantId}::uuid, 'MID-' || lpad(n::text, 5, '0'),
        'Fictional generic door ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 2000) AS n
    `;
    const last = await prisma.product.create({ data: { tenantId: seedData.tenantId,
      sku: 'ZZZ-REGION-1', name: 'Fictional Region door', aliases: [], stockQuantity: null,
      price: '2400.00', currency: null } });
    await prisma.message.update({ where: { id: seedData.anchorId }, data: { text: 'ZZZ-REGION-1?' } });
    const generate = vi.fn().mockResolvedValue({
      reply: { outcome: 'CLARIFY', text: 'Which door?', productIds: [], claims: [] },
      metadata: { model: 'fictional-model', latencyMs: 10, inputTokens: 20, outputTokens: 10 },
    });
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({
      tenantId: seedData.tenantId, draftId: seedData.draftId,
    })).toBe('READY');
    const draft = await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } });
    expect(JSON.stringify(draft.sourceSnapshot)).toContain(last.id);
    expect(JSON.stringify(draft.sourceSnapshot)).not.toContain('2400.00');
  });

  it.each(['AUTOMATIC', 'MANUAL'] as const)('does not call the model after %s model-family overflow', async (triggerSource) => {
    const seedData = await seed();
    await prisma.message.update({ where: { id: seedData.anchorId }, data: { text: 'Покажіть модель Регіон' } });
    await prisma.$executeRaw`
      INSERT INTO products (id, tenant_id, sku, name, aliases, active, updated_at)
      SELECT gen_random_uuid(), ${seedData.tenantId}::uuid, 'REGION-' || lpad(n::text, 3, '0'),
        'Регіон варіант ' || n::text, '[]'::jsonb, true, now()
      FROM generate_series(1, 65) AS n
    `;
    await prisma.aiReplyDraft.update({ where: { id: seedData.draftId },
      data: { triggerSource, ...(triggerSource === 'AUTOMATIC' ? { createdByUserId: null } : {}) } });
    const generate = vi.fn();
    expect(await new ReplyDraftProcessor(prisma, { generate }).process({
      tenantId: seedData.tenantId, draftId: seedData.draftId,
    })).toBe(triggerSource === 'AUTOMATIC' ? 'READY' : 'BLOCKED');
    expect(generate).not.toHaveBeenCalled();
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: triggerSource === 'AUTOMATIC' ? 'READY' : 'BLOCKED',
      outcome: triggerSource === 'AUTOMATIC' ? 'CLARIFY' : null,
      errorCode: triggerSource === 'AUTOMATIC' ? null : 'CATALOGUE_MODEL_OVERFLOW',
      modelRequestStartedAt: null, sourceSnapshot: [],
    });
  });

  it('durably fails a catalogue retrieval exception after a committed claim', async () => {
    const seedData = await seed();
    const generate = vi.fn();
    const processor = new ReplyDraftProcessor(prisma, { generate }, () => new Date(),
      async () => { throw new CatalogueRetrievalError(); });
    expect(await processor.process({ tenantId: seedData.tenantId, draftId: seedData.draftId })).toBe('FAILED');
    expect(generate).not.toHaveBeenCalled();
    expect(await prisma.aiReplyDraft.findUniqueOrThrow({ where: { id: seedData.draftId } })).toMatchObject({
      status: 'FAILED', errorCode: 'CATALOGUE_RETRIEVAL_FAILED', attempts: 1, leaseId: null,
    });
  });
});
