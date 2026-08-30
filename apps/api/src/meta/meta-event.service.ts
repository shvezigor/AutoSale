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
  ): Promise<{ eventId: string; duplicate: boolean }> {
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          tenantId: input.tenantId,
          provider: 'META',
          externalEventId: input.externalEventId,
          payload: input.payload as Prisma.InputJsonObject,
        },
        select: { id: true },
      });

      return { eventId: event.id, duplicate: false };
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
        select: { id: true },
      });

      return { eventId: existing.id, duplicate: true };
    }
  }
}
