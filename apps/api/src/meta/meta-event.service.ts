import type { RegisterMetaEventInput } from '@autosale/contracts/meta';
import { Prisma, type PrismaClient } from '@autosale/database';

export class MetaEventService {
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async resolveTenant(externalAccountId: string): Promise<string | null> {
    const connection = await this.prisma.instagramConnection.findUnique({ where: { externalAccountId }, select: { tenantId: true, status: true, tokenExpiresAt: true } });
    if (connection?.status !== 'ACTIVE') return null;
    if (connection.tokenExpiresAt !== null && connection.tokenExpiresAt <= this.now()) {
      await this.prisma.instagramConnection.updateMany({ where: { externalAccountId, status: 'ACTIVE', tokenExpiresAt: { lte: this.now() } }, data: { status: 'REAUTH_REQUIRED', lastErrorCode: 'META_TOKEN_EXPIRED' } });
      return null;
    }
    return connection.tenantId;
  }

  async register(
    input: RegisterMetaEventInput,
  ): Promise<{ eventId: string; duplicate: boolean; pending: boolean }> {
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          tenantId: input.tenantId,
          provider: 'META',
          externalEventId: input.externalEventId,
          payload: redactWebhookSecrets(input.payload) as Prisma.InputJsonObject,
        },
        select: { id: true },
      });

      return { eventId: event.id, duplicate: false, pending: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }

      const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: {
          tenantId_provider_externalEventId: {
            tenantId: input.tenantId,
            provider: 'META',
            externalEventId: input.externalEventId,
          },
        },
        select: { id: true, status: true },
      });

      return { eventId: existing.id, duplicate: true, pending: existing.status === 'RECEIVED' };
    }
  }
}

const redactedPayloadKeys = new Set(['access_token', 'appsecret_proof']);

function redactWebhookSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWebhookSecrets);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactedPayloadKeys.has(key.toLowerCase()) ? '[REDACTED]' : redactWebhookSecrets(item),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
