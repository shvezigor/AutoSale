import { materializeCommercialTerms, Prisma, type CommercialLineInput, type PrismaClient, type ProcurementStore } from '@autosale/database';

import type { ApprovalMode } from './approval-policy.js';
import { decideConversationalIntent, type IntentDetectionMode } from './order-intent-policy.js';
import { isOrderTrigger } from './order-trigger.js';
import type { OrderRecognitionService } from './order-recognition.service.js';
import type { TelegramAlertEvent } from '../notifications/telegram-alert.service.js';

export class TriggeredOrderProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly recognition: OrderRecognitionService,
    private readonly procurement: Pick<ProcurementStore, 'assessApprovedOrder'>,
    private readonly scheduleExport?: (orderId: string, tenantId: string) => Promise<void>,
    private readonly telemetry?: (event: string, fields: { correlationId: string; orderId: string; result: string }) => void,
    private readonly alerts?: { persist(tx: Prisma.TransactionClient, event: TelegramAlertEvent): Promise<void> },
  ) {}

  async processIfTriggered(
    messageId: string,
  ): Promise<{ id: string; status: string } | null> {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    const settings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId: message.tenantId },
    });
    if (!settings) return null;
    if (isOrderTrigger(message, stringArray(settings.triggerPhrases))) return this.process(messageId);
    if (
      message.direction === 'INBOUND'
      && message.text?.trim()
      && settings.intentDetectionMode !== 'PHRASE_ONLY'
    ) {
      return this.processConversationalIntent(message, settings);
    }

    return null;
  }

  private async processConversationalIntent(
    anchor: { id: string; tenantId: string; conversationId: string; rawEventId: string | null; sourceTimestamp: Date },
    settings: {
      intentDetectionMode: string;
      autoApprovalThreshold: number;
      promptVersion: string;
    },
  ): Promise<{ id: string; status: string } | null> {
    const claimed = await this.claimIntentEvaluation(anchor, settings.intentDetectionMode);
    if (!claimed.claimed) {
      if (!claimed.orderId) return null;
      return this.prisma.order.findUnique({ where: { id: claimed.orderId } });
    }

    const startedAt = Date.now();
    const correlationId = anchor.rawEventId ?? anchor.id;
    try {
      const [recentMessages, products, conversation] = await Promise.all([
        this.prisma.message.findMany({
          where: { conversationId: anchor.conversationId, sourceTimestamp: { lte: anchor.sourceTimestamp } },
          orderBy: { sourceTimestamp: 'desc' },
          take: 50,
        }),
        this.prisma.product.findMany({
          where: { tenantId: anchor.tenantId, active: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.conversation.findUnique({
          where: { id: anchor.conversationId },
          select: { displayName: true, profile: { select: { displayName: true, username: true } } },
        }),
      ]);
      const result = await this.recognition.recognize(
        {
          messages: recentMessages.reverse().map((message) => ({ id: message.id, direction: message.direction, text: message.text })),
          products: products.map((product) => ({ id: product.sku, name: product.name, aliases: stringArray(product.aliases) })),
          recognitionMode: 'CONVERSATIONAL_INTENT',
        },
        { approvalMode: 'ALWAYS', autoApprovalThreshold: settings.autoApprovalThreshold },
      );
      const decision = decideConversationalIntent({
        mode: settings.intentDetectionMode as IntentDetectionMode,
        isOrder: result.order.isOrder,
        anchorHasExplicitPurchaseIntent: result.order.anchorHasExplicitPurchaseIntent,
        hasUsableProduct: result.order.items.some((item) => item.originalText.trim().length > 0),
        isComplete: result.validationIssues.length === 0,
        confidence: result.order.overallConfidence,
        threshold: settings.autoApprovalThreshold,
      });
      const evaluationMetadata = {
        reason: decision.reason,
        aiResponseId: result.metadata.responseId,
        aiModel: result.metadata.model,
        inputTokens: result.metadata.inputTokens,
        outputTokens: result.metadata.outputTokens,
        latencyMs: Date.now() - startedAt,
        leaseExpiresAt: null,
        completedAt: new Date(),
      };
      if (decision.action === 'IGNORE') {
        await this.prisma.orderIntentEvaluation.update({
          where: { anchorMessageId: anchor.id },
          data: { ...evaluationMetadata, status: 'IGNORED' },
        });
        this.telemetry?.('ai_order_intent_evaluated', { correlationId, orderId: anchor.id, result: decision.reason });
        return null;
      }

      const autoApproved = decision.action === 'AUTO_CREATE';
      const order = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.order.create({
          data: {
            tenantId: anchor.tenantId,
            conversationId: anchor.conversationId,
            triggerMessageId: anchor.id,
            promptVersion: settings.promptVersion,
            status: autoApproved ? 'AUTO_APPROVED' : 'NEEDS_REVIEW',
            extraction: result.order as Prisma.InputJsonObject,
            validationIssues: result.validationIssues,
            overallConfidence: result.order.overallConfidence,
            aiResponseId: result.metadata.responseId,
            aiModel: result.metadata.model,
            inputTokens: result.metadata.inputTokens,
            outputTokens: result.metadata.outputTokens,
            approvedAt: autoApproved ? new Date() : null,
            approvedBy: autoApproved ? 'SYSTEM' : null,
            sortCustomer: normalizeSortValue(
              result.order.customer?.name
                ?? conversation?.profile?.displayName
                ?? conversation?.displayName
                ?? conversation?.profile?.username
                ?? '',
            ),
            sortProduct: productSortValue(result.order.items, new Map(products.map((product) => [product.sku, product.name]))),
          },
        });
        const commercialLines: CommercialLineInput[] = [];
        const productsBySku = new Map(products.map((product) => [product.sku, product]));
        for (const item of result.order.items) {
          const persisted = await transaction.orderItem.create({
            data: {
              tenantId: anchor.tenantId,
              orderId: created.id,
              catalogId: item.catalogId,
              originalText: item.originalText,
              quantity: item.quantity,
              color: item.color,
              size: item.size,
              confidence: item.confidence,
            },
          });
          commercialLines.push(commercialLine(persisted.id, item.catalogId, item.quantity, productsBySku));
        }
        await materializeCommercialTerms(transaction, {
          tenantId: anchor.tenantId,
          orderId: created.id,
          actor: 'SYSTEM',
          lines: commercialLines,
        });
        await transaction.orderIntentEvaluation.update({
          where: { anchorMessageId: anchor.id },
          data: {
            ...evaluationMetadata,
            orderId: created.id,
            status: autoApproved ? 'AUTO_CREATED' : 'PROPOSED',
          },
        });
        await this.alerts?.persist(transaction, {
          eventId: created.id,
          tenantId: anchor.tenantId,
          orderId: created.id,
          type: autoApproved ? 'ORDER_AUTO_APPROVED' : 'ORDER_NEEDS_REVIEW',
        });
        return created;
      });
      if (autoApproved) {
        await this.procurement.assessApprovedOrder(anchor.tenantId, order.id, 'SYSTEM');
        await this.scheduleExport?.(order.id, anchor.tenantId);
      }
      this.telemetry?.('ai_order_intent_evaluated', { correlationId, orderId: order.id, result: decision.reason });
      return order;
    } catch (error) {
      await this.prisma.orderIntentEvaluation.updateMany({
        where: { anchorMessageId: anchor.id, status: 'PROCESSING' },
        data: { status: 'FAILED', leaseExpiresAt: null, lastErrorCode: 'INTENT_EVALUATION_FAILED' },
      });
      throw error;
    }
  }

  private async claimIntentEvaluation(
    anchor: { id: string; tenantId: string; conversationId: string },
    mode: string,
  ): Promise<{ claimed: boolean; orderId: string | null }> {
    const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
    try {
      await this.prisma.orderIntentEvaluation.create({
        data: {
          tenantId: anchor.tenantId,
          conversationId: anchor.conversationId,
          anchorMessageId: anchor.id,
          mode,
          leaseExpiresAt,
        },
      });
      return { claimed: true, orderId: null };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }
    const existing = await this.prisma.orderIntentEvaluation.findUniqueOrThrow({ where: { anchorMessageId: anchor.id } });
    if (existing.orderId || ['IGNORED', 'PROPOSED', 'AUTO_CREATED'].includes(existing.status)) {
      return { claimed: false, orderId: existing.orderId };
    }
    const reclaimed = await this.prisma.orderIntentEvaluation.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: 'FAILED' },
          { status: 'PROCESSING', leaseExpiresAt: { lt: new Date() } },
        ],
      },
      data: {
        status: 'PROCESSING',
        mode,
        attempts: { increment: 1 },
        leaseExpiresAt,
        lastErrorCode: null,
      },
    });
    return { claimed: reclaimed.count === 1, orderId: null };
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
    const correlationId = trigger.rawEventId ?? trigger.id;
    const order = await this.createProcessingOrder({
      tenantId: trigger.tenantId,
      conversationId: trigger.conversationId,
      triggerMessageId,
      promptVersion: settings.promptVersion,
    });
    if (order.status !== 'AI_PROCESSING') return order;

    try {
      const [recentMessages, products, conversation] = await Promise.all([
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
        this.prisma.conversation.findUnique({
          where: { id: trigger.conversationId },
          select: { displayName: true, profile: { select: { displayName: true, username: true } } },
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
          recognitionMode: 'TRIGGERED_ORDER',
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
          sortCustomer: normalizeSortValue(
            result.order.customer?.name
              ?? conversation?.profile?.displayName
              ?? conversation?.displayName
              ?? conversation?.profile?.username
              ?? '',
          ),
          sortProduct: productSortValue(result.order.items, new Map(products.map((product) => [product.sku, product.name]))),
          },
        });
        const commercialLines: CommercialLineInput[] = [];
        const productsBySku = new Map(products.map((product) => [product.sku, product]));
        for (const item of result.order.items) {
          const persisted = await transaction.orderItem.create({
            data: {
              tenantId: trigger.tenantId,
              orderId: order.id,
              catalogId: item.catalogId,
              originalText: item.originalText,
              quantity: item.quantity,
              color: item.color,
              size: item.size,
              confidence: item.confidence,
            },
          });
          commercialLines.push(commercialLine(persisted.id, item.catalogId, item.quantity, productsBySku));
        }
        await materializeCommercialTerms(transaction, {
          tenantId: trigger.tenantId,
          orderId: order.id,
          actor: 'SYSTEM',
          lines: commercialLines,
        });
        await this.alerts?.persist(transaction, {
          eventId: order.id,
          tenantId: trigger.tenantId,
          orderId: order.id,
          type: autoApproved ? 'ORDER_AUTO_APPROVED' : 'ORDER_NEEDS_REVIEW',
        });
        return persisted;
      });
      if (autoApproved) {
        const assessment = await this.procurement.assessApprovedOrder(trigger.tenantId, order.id, 'SYSTEM');
        this.telemetry?.('procurement_assessment_completed', { correlationId, orderId: order.id, result: 'success' });
        if (assessment.items.some((item) => item.reason === 'RESERVATION_CONFLICT')) {
          this.telemetry?.('procurement_reservation_conflict_completed', { correlationId, orderId: order.id, result: 'conflict' });
        }
        await this.scheduleExport?.(order.id, trigger.tenantId);
      }
      this.telemetry?.('ai_order_recognition_completed', { correlationId, orderId: order.id, result: result.status });
      return updated;
    } catch (error) {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: 'AI_FAILED' } });
      this.telemetry?.('ai_order_recognition_failed', { correlationId, orderId: order.id, result: 'failure' });
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

function normalizeSortValue(value: string): string {
  return value.trim().toLocaleLowerCase('uk-UA');
}

function productSortValue(
  items: Array<{ catalogId: string | null; originalText: string }>,
  products: Map<string, string>,
): string {
  return normalizeSortValue(items.map((item) => item.catalogId ? products.get(item.catalogId) ?? item.originalText : item.originalText).filter(Boolean).join(', '));
}

function commercialLine(
  itemId: string,
  catalogId: string | null,
  quantity: number,
  products: Map<string, { sku: string; price: Prisma.Decimal | null; currency: string | null }>,
): CommercialLineInput {
  const product = catalogId ? products.get(catalogId) : undefined;
  return {
    itemId,
    quantity,
    unitPrice: product?.price?.toFixed(2) ?? null,
    currency: product?.currency ?? null,
    sourceSku: product?.sku ?? null,
  };
}
