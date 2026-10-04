import {
  assertTenantAcceptingMutations,
  Prisma,
  type PrismaClient,
  TenantLifecycleFrozenError,
  withTenantTransaction,
} from '@autosale/database';
import { metrics } from '@autosale/observability';

export interface RegisterTikTokEventInput {
  tenantId: string;
  externalEventId: string;
  payload: Record<string, unknown>;
}

export class TikTokEventService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolveTenant(externalAccountId: string): Promise<string | null> {
    const authority = await this.prisma.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM public.api_tiktok_tenant_for_account(${externalAccountId})
    `;
    const tenantId = authority[0]?.tenant_id;
    if (!tenantId) return null;

    return withTenantTransaction(this.prisma, tenantId, async (transaction) => {
      const connection = await transaction.tikTokConnection.findUnique({
        where: { externalAccountId },
        select: { tenantId: true, status: true, tokenExpiresAt: true },
      });
      if (connection?.status !== 'ACTIVE' && connection?.status !== 'INBOUND_ONLY') return null;
      const now = this.now();
      if (connection.tokenExpiresAt !== null && connection.tokenExpiresAt <= now) {
        await transaction.tikTokConnection.updateMany({
          where: {
            externalAccountId,
            status: { in: ['ACTIVE', 'INBOUND_ONLY'] },
            tokenExpiresAt: { lte: now },
          },
          data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'TIKTOK_TOKEN_EXPIRED' },
        });
        return null;
      }
      return connection.tenantId;
    });
  }

  async register(input: RegisterTikTokEventInput): Promise<
    | { eventId: string; duplicate: boolean; pending: boolean }
    | { eventId: null; duplicate: false; pending: false; frozen: true }
  > {
    try {
      const event = await withTenantTransaction(this.prisma, input.tenantId, async (transaction) => {
        await assertTenantAcceptingMutations(transaction, input.tenantId, 'META_INBOUND');
        return transaction.webhookEvent.create({
          data: {
            tenantId: input.tenantId,
            provider: 'TIKTOK',
            externalEventId: input.externalEventId,
            payload: redactSecrets(input.payload) as Prisma.InputJsonObject,
          },
          select: { id: true },
        });
      });
      return { eventId: event.id, duplicate: false, pending: true };
    } catch (error) {
      if (error instanceof TenantLifecycleFrozenError) {
        metrics.increment('autosale_tenant_lifecycle_freeze_rejections_total', {
          surface: 'META_INBOUND', safe_reason: 'lifecycle_frozen',
        });
        return { eventId: null, duplicate: false, pending: false, frozen: true };
      }
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await withTenantTransaction(this.prisma, input.tenantId, (transaction) =>
        transaction.webhookEvent.findUniqueOrThrow({
          where: {
            tenantId_provider_externalEventId: {
              tenantId: input.tenantId,
              provider: 'TIKTOK',
              externalEventId: input.externalEventId,
            },
          },
          select: { id: true, status: true },
        }));
      return { eventId: existing.id, duplicate: true, pending: existing.status === 'RECEIVED' };
    }
  }
}

const secretKeys = new Set(['access_token', 'refresh_token', 'secret', 'client_secret', 'app_secret']);

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    secretKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactSecrets(item),
  ]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
