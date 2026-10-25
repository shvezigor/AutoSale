import type {
  AiProviderUsageErrorCategory,
  AiProviderUsageOutcome,
  AiProviderUsagePurpose,
  PrismaClient,
} from './generated/prisma/client.js';
import { withTenantTransaction } from './tenant-transaction.js';

export type AiUsageContext = {
  tenantId: string;
  operationId: string;
  purpose: AiProviderUsagePurpose;
};

/** NULL means unavailable; zero is an explicitly reported provider value. */
export type AiProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

export type AiUsageTerminalOutcome = Exclude<AiProviderUsageOutcome, 'STARTED'>;
export type AiUsageErrorCategory = AiProviderUsageErrorCategory;

export class AiProviderUsageStore {
  constructor(private readonly prisma: PrismaClient) {}

  async start(context: AiUsageContext, requestedModel: string, attemptId: string, now: Date): Promise<void> {
    await withTenantTransaction(this.prisma, context.tenantId, async (tx) => {
      await tx.aiProviderUsageAttempt.create({
        data: { ...context, id: attemptId, provider: 'OPENAI', requestedModel, startedAt: now },
      });
    });
  }

  async finalize(
    context: AiUsageContext,
    attemptId: string,
    outcome: AiUsageTerminalOutcome,
    usage: AiProviderUsage,
    returnedModel: string | null,
    now: Date,
    errorCategory: AiUsageErrorCategory | null = null,
  ): Promise<boolean> {
    return withTenantTransaction(this.prisma, context.tenantId, async (tx) => {
      const changed = await tx.aiProviderUsageAttempt.updateMany({
        where: { id: attemptId, ...context, outcome: 'STARTED' },
        data: { outcome, ...usage, returnedModel, finalizedAt: now, errorCategory },
      });
      return changed.count === 1;
    });
  }
}
