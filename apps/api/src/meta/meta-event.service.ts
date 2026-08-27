import type { RegisterMetaEventInput } from '@autosale/contracts/meta';
import { Prisma, type PrismaClient } from '@autosale/database';

export class MetaEventService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveTenant(externalAccountId: string): Promise<string | null> {
    const connection = await this.prisma.instagramConnection.findUnique({ where: { externalAccountId }, select: { tenantId: true, status: true } });
    return connection?.status === 'ACTIVE' ? connection.tenantId : null;
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
