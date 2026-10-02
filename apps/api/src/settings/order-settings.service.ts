import { assertTenantAcceptingMutations, Prisma, TenantLifecycleFrozenError, type PrismaClient, withTenantTransaction } from '@autosale/database';
import { INSTAGRAM_ORDER_PROMPT_VERSION } from '@autosale/contracts';

export interface OrderSettingsResponse {
  intentDetectionMode: 'PHRASE_ONLY' | 'AI_SUGGESTION' | 'AI_AUTOMATION';
  approvalMode: 'ALWAYS' | 'NEVER' | 'ON_LOW_CONFIDENCE';
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: string[];
}

export interface UpdateOrderSettingsInput {
  intentDetectionMode?: OrderSettingsResponse['intentDetectionMode'];
  approvalMode?: OrderSettingsResponse['approvalMode'];
  autoApprovalThreshold?: number;
  triggerPhrases?: string[];
}

export class OrderSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<OrderSettingsResponse> {
    const settings = await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      if (typeof transaction.tenantSettings.findUnique !== 'function') {
        return transaction.tenantSettings.upsert({
          where: { tenantId }, update: {}, create: defaultSettings(tenantId),
        });
      }
      const existing = await transaction.tenantSettings.findUnique({ where: { tenantId } });
      if (existing) return existing;
      try {
        await assertTenantAcceptingMutations(transaction, tenantId, 'ORDER_MUTATION');
      } catch (error) {
        if (error instanceof TenantLifecycleFrozenError) return defaultSettings(tenantId);
        throw error;
      }
      return transaction.tenantSettings.create({ data: defaultSettings(tenantId) });
    });
    return toResponse(settings);
  }

  async update(tenantId: string, input: UpdateOrderSettingsInput): Promise<OrderSettingsResponse> {
    return toResponse(
      await withTenantTransaction(this.prisma, tenantId, async (transaction) => {
        await assertTenantAcceptingMutations(transaction, tenantId, 'ORDER_MUTATION');
        return transaction.tenantSettings.update({
          where: { tenantId },
          data: input,
        });
      }),
    );
  }
}

function defaultSettings(tenantId: string): {
  tenantId: string; intentDetectionMode: 'PHRASE_ONLY'; approvalMode: 'ALWAYS'; autoApprovalThreshold: number;
  promptVersion: string; triggerPhrases: string[];
} {
  return {
    tenantId,
    intentDetectionMode: 'PHRASE_ONLY',
    approvalMode: 'ALWAYS',
    autoApprovalThreshold: 0.9,
    promptVersion: INSTAGRAM_ORDER_PROMPT_VERSION,
    triggerPhrases: ['беремо замовлення в роботу', 'замовлення прийнято'],
  };
}

function toResponse(settings: {
  intentDetectionMode: string;
  approvalMode: string;
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: Prisma.JsonValue;
}): OrderSettingsResponse {
  return {
    intentDetectionMode: settings.intentDetectionMode as OrderSettingsResponse['intentDetectionMode'],
    approvalMode: settings.approvalMode as OrderSettingsResponse['approvalMode'],
    autoApprovalThreshold: settings.autoApprovalThreshold,
    promptVersion: settings.promptVersion,
    triggerPhrases: Array.isArray(settings.triggerPhrases)
      ? settings.triggerPhrases.filter((value): value is string => typeof value === 'string')
      : [],
  };
}
