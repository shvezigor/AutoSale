import { Prisma, type PrismaClient } from '@autosale/database';

import type { ApprovalMode } from './approval-policy.js';
import { isOrderTrigger } from './order-trigger.js';
import type { OrderRecognitionService } from './order-recognition.service.js';

export class TriggeredOrderProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly recognition: OrderRecognitionService,
    private readonly scheduleExport?: (orderId: string, tenantId: string) => Promise<void>,
    private readonly telemetry?: (event: string, fields: { correlationId: string; orderId: string; result: string }) => void,
  ) {}

  async processIfTriggered(
    messageId: string,
  ): Promise<{ id: string; status: string } | null> {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId: message.tenantId },
    });
    if (!settings || !isOrderTrigger(message, stringArray(settings.triggerPhrases))) return null;

    return this.process(messageId);
  }

  async process(triggerMessageId: string): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.order.findUnique({ where: { triggerMessageId } });
    if (existing) return existing;

    const trigger = await this.prisma.message.findUniqueOrThrow({
      where: { id: triggerMessageId },
    });
    const settings = await this.prisma.tenantSettings.findUniqueOrThrow({
      where: { tenantId: trigger.tenantId },
    });
    const order = await this.createProcessingOrder({
      tenantId: trigger.tenantId,
      conversationId: trigger.conversationId,
      triggerMessageId,
      promptVersion: settings.promptVersion,
    });
    if (order.status !== 'AI_PROCESSING') return order;

    try {
      const [recentMessages, products] = await Promise.all([
        this.prisma.message.findMany({
          where: {
            conversationId: trigger.conversationId,
            sourceTimestamp: { lte: trigger.sourceTimestamp },
          },
          orderBy: { sourceTimestamp: 'desc' },
          take: 50,
        }),
        this.prisma.product.findMany({
          where: { tenantId: trigger.tenantId, active: true },
          orderBy: { name: 'asc' },
        }),
      ]);
      const result = await this.recognition.recognize(
        {
          messages: recentMessages.reverse().map((message) => ({
            id: message.id,
            direction: message.direction,
            text: message.text,
          })),
          products: products.map((product) => ({
            id: product.sku,
            name: product.name,
            aliases: stringArray(product.aliases),
          })),
        },
        {
          approvalMode: settings.approvalMode as ApprovalMode,
          autoApprovalThreshold: settings.autoApprovalThreshold,
        },
      );
      const autoApproved = result.status === 'AUTO_APPROVED';

      const updated = await this.prisma.$transaction(async (transaction) => {
        const persisted = await transaction.order.update({
          where: { id: order.id },
          data: {
          status: result.status,
          extraction: result.order as Prisma.InputJsonObject,
          validationIssues: result.validationIssues,
          overallConfidence: result.order.overallConfidence,
          aiResponseId: result.metadata.responseId,
          aiModel: result.metadata.model,
          inputTokens: result.metadata.inputTokens,
          outputTokens: result.metadata.outputTokens,
          approvedAt: autoApproved ? new Date() : null,
          approvedBy: autoApproved ? 'SYSTEM' : null,
          },
        });
        for (const item of result.order.items) {
          await transaction.$executeRaw(Prisma.sql`
            INSERT INTO "order_items" ("id", "order_id", "catalog_id", "original_text", "quantity", "color", "size", "confidence")
            VALUES (gen_random_uuid(), ${order.id}::uuid, ${item.catalogId}, ${item.originalText}, ${item.quantity}, ${item.color}, ${item.size}, ${item.confidence})
          `);
        }
        return persisted;
      });
      if (autoApproved) {
        await this.scheduleExport?.(order.id, trigger.tenantId);
      }
      this.telemetry?.('ai_order_recognition_completed', { correlationId: trigger.rawEventId, orderId: order.id, result: result.status });
      return updated;
    } catch (error) {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'AI_FAILED' } });
      this.telemetry?.('ai_order_recognition_failed', { correlationId: trigger.rawEventId, orderId: order.id, result: 'failure' });
      throw error;
    }
  }

  private async createProcessingOrder(input: {
    tenantId: string;
    conversationId: string;
    triggerMessageId: string;
    promptVersion: string;
  }): Promise<{ id: string; status: string }> {
    try {
      return await this.prisma.order.create({ data: input });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.order.findUniqueOrThrow({
          where: { triggerMessageId: input.triggerMessageId },
        });
      }
      throw error;
    }
  }
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
