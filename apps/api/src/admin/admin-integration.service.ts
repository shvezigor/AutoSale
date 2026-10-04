import type {
  AdminIntegrationControl,
  AdminIntegrationKey,
  AdminIntegrationUpdate,
} from '@autosale/contracts';
import {
  appendSecurityAudit,
  PlatformChannelGate,
  type PlatformChannelDeploymentAvailability,
  type PrismaClient,
  toPlatformChannelControl,
} from '@autosale/database';

type AuditAppender = typeof appendSecurityAudit;

export class AdminIntegrationUnavailableError extends Error {
  constructor(readonly key: AdminIntegrationKey) {
    super('Channel deployment is unavailable');
    this.name = 'AdminIntegrationUnavailableError';
  }
}

export class AdminIntegrationService {
  private readonly gate: PlatformChannelGate;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly deployment: PlatformChannelDeploymentAvailability,
    private readonly appendAudit: AuditAppender = appendSecurityAudit,
  ) {
    this.gate = new PlatformChannelGate(prisma, deployment);
  }

  list(): Promise<AdminIntegrationControl[]> {
    return this.gate.listControls();
  }

  async update(
    actorUserId: string,
    key: AdminIntegrationKey,
    input: AdminIntegrationUpdate,
  ): Promise<AdminIntegrationControl> {
    if (input.enabled && !this.deployment[key]) {
      await this.appendAudit(this.prisma, {
        tenantId: null,
        userId: actorUserId,
        actor: 'USER',
        action: 'PLATFORM_SOCIAL_CHANNEL_STATE_CHANGED',
        result: 'FAILURE',
        metadata: { channel: key, enabled: true, reason: 'DEPLOYMENT_UNAVAILABLE' },
      });
      throw new AdminIntegrationUnavailableError(key);
    }

    return this.prisma.$transaction(async (transaction) => {
      const previous = await transaction.platformFeatureFlag.findUnique({
        where: { key },
        select: { enabled: true },
      });
      const row = await transaction.platformFeatureFlag.upsert({
        where: { key },
        create: { key, enabled: input.enabled, updatedByUserId: actorUserId },
        update: { enabled: input.enabled, updatedByUserId: actorUserId },
        select: { enabled: true, updatedAt: true },
      });
      await this.appendAudit(transaction, {
        tenantId: null,
        userId: actorUserId,
        actor: 'USER',
        action: 'PLATFORM_SOCIAL_CHANNEL_STATE_CHANGED',
        result: 'SUCCESS',
        metadata: {
          channel: key,
          previousEnabled: previous?.enabled ?? false,
          enabled: row.enabled,
        },
      });
      return toPlatformChannelControl(key, this.deployment[key], row);
    });
  }
}
