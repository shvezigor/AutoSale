import { Prisma, type PrismaClient } from '@autosale/database';

export interface OrderSettingsResponse {
  approvalMode: 'ALWAYS' | 'NEVER' | 'ON_LOW_CONFIDENCE';
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: string[];
}

export interface UpdateOrderSettingsInput {
  approvalMode?: OrderSettingsResponse['approvalMode'];
  autoApprovalThreshold?: number;
  triggerPhrases?: string[];
}

export class OrderSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<OrderSettingsResponse> {
    return toResponse(
      await this.prisma.tenantSettings.upsert({
        where: { tenantId },
        update: {},
        create: {
          tenantId,
          approvalMode: 'ALWAYS',
          autoApprovalThreshold: 0.9,
          promptVersion: 'instagram-order-v1',
          triggerPhrases: [
            'беремо замовлення в роботу',
            'замовлення прийнято',
          ],
        },
      }),
    );
  }

  async update(tenantId: string, input: UpdateOrderSettingsInput): Promise<OrderSettingsResponse> {
    return toResponse(
      await this.prisma.tenantSettings.update({
        where: { tenantId },
        data: input,
      }),
    );
  }
}

function toResponse(settings: {
  approvalMode: string;
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: Prisma.JsonValue;
}): OrderSettingsResponse {
  return {
    approvalMode: settings.approvalMode as OrderSettingsResponse['approvalMode'],
    autoApprovalThreshold: settings.autoApprovalThreshold,
    promptVersion: settings.promptVersion,
    triggerPhrases: Array.isArray(settings.triggerPhrases)
      ? settings.triggerPhrases.filter((value): value is string => typeof value === 'string')
      : [],
  };
}
