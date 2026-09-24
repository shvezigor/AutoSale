import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createPrismaClient, Prisma, type PrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OrderRecognitionService } from './order-recognition.service.js';
import { TriggeredOrderProcessor } from './triggered-order.processor.js';

describe('TriggeredOrderProcessor', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    const migrationsDirectory = resolve(process.cwd(), '../../packages/database/prisma/migrations');
    for (const migration of (await readdir(migrationsDirectory)).sort()) {
      if (migration === 'migration_lock.toml') continue;
      await pool.query(
        await readFile(resolve(migrationsDirectory, migration, 'migration.sql'), 'utf8'),
      );
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('derives a compact two-letter public-number prefix from the company name', async () => {
    const [result] = await prisma.$queryRaw<Array<{ prefix: string }>>(
      Prisma.sql`SELECT "autosale_order_prefix"('AutoSale') AS "prefix"`,
    );

    expect(result?.prefix).toBe('AS');
  });

  it('persists one auto-approved order for a trigger message', async () => {
    const tenant = await prisma.tenant.create({ data: { key: 'orders', name: 'Orders' } });
    await prisma.tenantSettings.create({
      data: {
        tenantId: tenant.id,
        approvalMode: 'NEVER',
        autoApprovalThreshold: 0.9,
        promptVersion: 'instagram-order-v1',
        triggerPhrases: ['беремо замовлення в роботу'],
      },
    });
    const event = await prisma.webhookEvent.create({
      data: { tenantId: tenant.id, provider: 'META', externalEventId: 'event-order', payload: {} },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: 'INSTAGRAM',
        externalConversationId: 'ig-customer',
        participantId: 'ig-customer',
        lastMessageAt: new Date('2026-08-26T12:01:00Z'),
      },
    });
    await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'customer-order',
        direction: 'INBOUND',
        senderId: 'ig-customer',
        text: 'Хочу чорний костюм, розмір M, одна штука',
        sourceTimestamp: new Date('2026-08-26T12:00:00Z'),
      },
    });
    const trigger = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'manager-confirmation',
        direction: 'OUTBOUND',
        senderId: 'page',
        text: 'Дякуємо, беремо замовлення в роботу',
        sourceTimestamp: new Date('2026-08-26T12:01:00Z'),
      },
    });
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        sku: 'SKU-1',
        name: 'Костюм Classic',
        aliases: ['чорний костюм'],
        price: '4395.00',
        currency: 'UAH',
      },
    });
    const recognize = vi.fn().mockResolvedValue({
      order: {
        isOrder: true,
        anchorHasExplicitPurchaseIntent: false,
        customer: { name: 'Іван', phone: '+380501112233', instagramUsername: 'ig-customer' },
        delivery: { city: 'Львів', address: null, novaPoshtaBranch: '12' },
        items: [
          {
            catalogId: 'SKU-1',
            originalText: 'чорний костюм',
            quantity: 1,
            color: 'чорний',
            size: 'M',
            confidence: 0.96,
          },
        ],
        missingFields: [],
        overallConfidence: 0.95,
      },
      metadata: {
        responseId: 'resp-order',
        model: 'gpt-5.4-mini',
        inputTokens: 150,
        outputTokens: 90,
      },
    });
    const telemetry = vi.fn();
    const alerts = { persist: vi.fn().mockResolvedValue(undefined) };
    const procurement = {
      assessApprovedOrder: vi.fn().mockResolvedValue({ orderId: 'pending', summary: 'NEEDS_ORDER', items: [] }),
      releaseOrderReservations: vi.fn(),
    };
    const processor = new TriggeredOrderProcessor(
      prisma,
      new OrderRecognitionService({ recognize }),
      procurement as never,
      undefined,
      telemetry,
      alerts,
    );

    const first = await processor.processIfTriggered(trigger.id);
    const replay = await processor.processIfTriggered(trigger.id);

    expect(replay?.id).toBe(first?.id);
    expect(await prisma.order.count({ where: { triggerMessageId: trigger.id } })).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({
      where: { id: first!.id },
      include: { items: true },
    })).toMatchObject({
      publicNumber: expect.stringMatching(/^OR-\d{6}$/),
      status: 'AUTO_APPROVED',
      approvedBy: 'SYSTEM',
      aiResponseId: 'resp-order',
      sortCustomer: 'іван',
      sortProduct: 'костюм classic',
      items: [{ catalogId: 'SKU-1', size: 'M', unitPriceSnapshot: new Prisma.Decimal('4395.00'), lineTotalSnapshot: new Prisma.Decimal('4395.00'), currencySnapshot: 'UAH' }],
    });
    expect(await prisma.orderCommercialTerms.findUnique({ where: { orderId: first!.id } })).toMatchObject({
      pricingStatus: 'READY',
      currency: 'UAH',
      itemsSubtotal: new Prisma.Decimal('4395.00'),
      totalAmount: new Prisma.Decimal('4395.00'),
    });
    const persistedItems = await prisma.$queryRaw<Array<{ quantity: number }>>(
      Prisma.sql`SELECT "quantity" FROM "order_items" WHERE "order_id" = ${first!.id}::uuid`,
    );
    expect(persistedItems).toEqual([{ quantity: 1 }]);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(procurement.assessApprovedOrder).toHaveBeenCalledWith(tenant.id, first!.id, 'SYSTEM');
    expect(alerts.persist).toHaveBeenCalledWith(expect.anything(), {
      eventId: first!.id,
      tenantId: tenant.id,
      orderId: first!.id,
      type: 'ORDER_AUTO_APPROVED',
    });
    expect(telemetry).toHaveBeenCalledWith('ai_order_recognition_completed', expect.objectContaining({ orderId: first!.id, result: 'AUTO_APPROVED' }));
  });

  it('creates idempotent proposals and automatic orders for new inbound revisions according to owner mode', async () => {
    const tenant = await prisma.tenant.create({ data: { key: 'intent-suggestion', name: 'Intent suggestion' } });
    await prisma.tenantSettings.create({
      data: {
        tenantId: tenant.id,
        intentDetectionMode: 'AI_SUGGESTION',
        approvalMode: 'NEVER',
        autoApprovalThreshold: 0.9,
        promptVersion: 'instagram-order-v2',
        triggerPhrases: ['замовлення прийнято'],
      },
    });
    const event = await prisma.webhookEvent.create({
      data: { tenantId: tenant.id, provider: 'META', externalEventId: 'intent-suggestion-event', payload: {} },
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: 'INSTAGRAM',
        externalConversationId: 'intent-suggestion-customer',
        participantId: 'intent-suggestion-customer',
        lastMessageAt: new Date('2026-09-18T09:00:00Z'),
      },
    });
    const anchor = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'intent-suggestion-message',
        direction: 'INBOUND',
        senderId: 'customer',
        text: 'Беру двері Авангард, доставляйте у Луцьк на відділення 22',
        sourceTimestamp: new Date('2026-09-18T09:00:00Z'),
      },
    });
    await prisma.product.create({ data: { tenantId: tenant.id, sku: 'DOOR-1', name: 'Двері Авангард', aliases: ['двері авангард'], price: '8000.00', currency: 'UAH' } });
    const recognize = vi.fn().mockResolvedValue({
      order: {
        isOrder: true,
        anchorHasExplicitPurchaseIntent: true,
        customer: { name: 'Ігор', phone: '+380501112233', instagramUsername: 'customer' },
        delivery: { city: 'Луцьк', address: null, novaPoshtaBranch: '22' },
        items: [{ catalogId: 'DOOR-1', originalText: 'двері Авангард', quantity: 1, color: null, size: null, confidence: 0.98 }],
        missingFields: [],
        overallConfidence: 0.97,
      },
      metadata: { responseId: 'resp-intent', model: 'gpt-5.4-mini', inputTokens: 90, outputTokens: 50 },
    });
    const assessApprovedOrder = vi.fn().mockResolvedValue({ orderId: 'automatic', summary: 'READY', items: [] });
    const scheduleExport = vi.fn().mockResolvedValue(undefined);
    const processor = new TriggeredOrderProcessor(
      prisma,
      new OrderRecognitionService({ recognize }),
      { assessApprovedOrder } as never,
      scheduleExport,
    );

    const first = await processor.processIfTriggered(anchor.id);
    const replay = await processor.processIfTriggered(anchor.id);

    expect(first).toMatchObject({ status: 'NEEDS_REVIEW' });
    expect(replay?.id).toBe(first?.id);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(await prisma.orderIntentEvaluation.findUniqueOrThrow({ where: { anchorMessageId: anchor.id } })).toMatchObject({
      orderId: first?.id,
      mode: 'AI_SUGGESTION',
      status: 'PROPOSED',
      reason: 'MANAGER_REVIEW_MODE',
      aiResponseId: 'resp-intent',
    });
    expect(await prisma.orderCommercialTerms.findUniqueOrThrow({ where: { orderId: first!.id } })).toMatchObject({
      pricingStatus: 'READY', currency: 'UAH', totalAmount: new Prisma.Decimal('8000.00'),
    });

    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: { intentDetectionMode: 'AI_AUTOMATION' },
    });
    const automaticAnchor = await prisma.message.create({
      data: {
        tenantId: tenant.id,
        conversationId: conversation.id,
        rawEventId: event.id,
        channel: 'INSTAGRAM',
        externalMessageId: 'intent-automation-message',
        direction: 'INBOUND',
        senderId: 'customer',
        text: 'Так, усе вірно — оформляйте',
        sourceTimestamp: new Date('2026-09-18T09:01:00Z'),
      },
    });

    const automatic = await processor.processIfTriggered(automaticAnchor.id);
    const automaticReplay = await processor.processIfTriggered(automaticAnchor.id);

    expect(automatic).toMatchObject({ status: 'AUTO_APPROVED' });
    expect(automaticReplay?.id).toBe(automatic?.id);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(assessApprovedOrder).toHaveBeenCalledWith(tenant.id, automatic?.id, 'SYSTEM');
    expect(scheduleExport).toHaveBeenCalledWith(automatic?.id, tenant.id);
    expect(await prisma.orderIntentEvaluation.findUniqueOrThrow({ where: { anchorMessageId: automaticAnchor.id } })).toMatchObject({
      orderId: automatic?.id,
      mode: 'AI_AUTOMATION',
      status: 'AUTO_CREATED',
      reason: 'COMPLETE_HIGH_CONFIDENCE',
    });
    expect(await prisma.orderCommercialTerms.findUniqueOrThrow({ where: { orderId: automatic!.id } })).toMatchObject({
      pricingStatus: 'READY', currency: 'UAH', totalAmount: new Prisma.Decimal('8000.00'),
    });

    await prisma.product.update({ where: { tenantId_sku: { tenantId: tenant.id, sku: 'DOOR-1' } }, data: { price: null, currency: null } });
    const unpricedAnchor = await prisma.message.create({
      data: {
        tenantId: tenant.id, conversationId: conversation.id, rawEventId: event.id, channel: 'INSTAGRAM',
        externalMessageId: 'intent-unpriced-message', direction: 'INBOUND', senderId: 'customer',
        text: 'Оформляйте ще одні двері', sourceTimestamp: new Date('2026-09-18T09:02:00Z'),
      },
    });
    const unpriced = await processor.processIfTriggered(unpricedAnchor.id);
    expect(unpriced).toMatchObject({ status: 'AUTO_APPROVED' });
    expect(await prisma.orderCommercialTerms.findUniqueOrThrow({ where: { orderId: unpriced!.id } })).toMatchObject({
      pricingStatus: 'NEEDS_REVIEW', currency: null, totalAmount: null,
    });
  });
});
