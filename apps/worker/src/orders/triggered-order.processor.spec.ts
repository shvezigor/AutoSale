import { readFile } from 'node:fs/promises';
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
    const migrations = [
      '20260826090000_init_webhook_events',
      '20260826123000_conversations_messages',
      '20260826203000_ai_order_recognition',
      '20260826210000_product_catalog',
      '20260827160000_self_hosted_auth',
      '20260827170000_tenant_access_status',
      '20260827230000_instagram_connections',
      '20260828_meta_instagram_oauth',
      '20260828150000_instagram_oauth_attempt_guard',
      '20260829120000_instagram_credential_cleanup_queue',
      '20260902090000_instagram_customer_profiles',
      '20260831090000_catalogue_import',
      '20260831091500_catalogue_tenant_relations',
      '20260831100000_catalogue_source_object_key',
    ];
    const pool = new pg.Pool({ connectionString });
    for (const migration of migrations) {
      await pool.query(
        await readFile(
          resolve(
            process.cwd(),
            `../../packages/database/prisma/migrations/${migration}/migration.sql`,
          ),
          'utf8',
        ),
      );
    }
    await pool.end();
    prisma = createPrismaClient(connectionString);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
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
      },
    });
    const recognize = vi.fn().mockResolvedValue({
      order: {
        isOrder: true,
        customer: { name: null, phone: null, instagramUsername: 'ig-customer' },
        delivery: { city: null, address: null, novaPoshtaBranch: null },
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
    const processor = new TriggeredOrderProcessor(
      prisma,
      new OrderRecognitionService({ recognize }),
      undefined,
      telemetry,
    );

    const first = await processor.processIfTriggered(trigger.id);
    const replay = await processor.processIfTriggered(trigger.id);

    expect(replay?.id).toBe(first?.id);
    expect(await prisma.order.count({ where: { triggerMessageId: trigger.id } })).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({
      where: { id: first!.id },
      include: { items: true },
    })).toMatchObject({
      status: 'AUTO_APPROVED',
      approvedBy: 'SYSTEM',
      aiResponseId: 'resp-order',
      items: [{ catalogId: 'SKU-1', size: 'M' }],
    });
    const persistedItems = await prisma.$queryRaw<Array<{ quantity: number }>>(
      Prisma.sql`SELECT "quantity" FROM "order_items" WHERE "order_id" = ${first!.id}::uuid`,
    );
    expect(persistedItems).toEqual([{ quantity: 1 }]);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith('ai_order_recognition_completed', expect.objectContaining({ orderId: first!.id, result: 'AUTO_APPROVED' }));
  });
});
