import type {
  AdminIntegrationControl,
  AdminIntegrationKey,
} from '@autosale/contracts/auth';

import type { PrismaClient } from './generated/prisma/client.js';

export const PLATFORM_CHANNEL_KEYS = [
  'FACEBOOK_MESSENGER',
  'TIKTOK_BUSINESS_MESSAGING',
] as const satisfies readonly AdminIntegrationKey[];

export type PlatformChannelDeploymentAvailability = Readonly<Record<AdminIntegrationKey, boolean>>;

export class PlatformChannelDisabledError extends Error {
  constructor(readonly key: AdminIntegrationKey) {
    super('Platform channel is disabled');
    this.name = 'PlatformChannelDisabledError';
  }
}

export class PlatformChannelDeploymentUnavailableError extends PlatformChannelDisabledError {
  constructor(key: AdminIntegrationKey) {
    super(key);
    this.name = 'PlatformChannelDeploymentUnavailableError';
  }
}

export class PlatformChannelGate {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deployment: PlatformChannelDeploymentAvailability,
  ) {}

  async getControl(key: AdminIntegrationKey): Promise<AdminIntegrationControl> {
    const row = await this.prisma.platformFeatureFlag.findUnique({
      where: { key },
      select: { enabled: true, updatedAt: true },
    });
    return toPlatformChannelControl(key, this.deployment[key], row ?? null);
  }

  async listControls(): Promise<AdminIntegrationControl[]> {
    return Promise.all(PLATFORM_CHANNEL_KEYS.map((key) => this.getControl(key)));
  }

  async isEnabled(key: AdminIntegrationKey): Promise<boolean> {
    return (await this.getControl(key)).effectiveEnabled;
  }

  async assertEnabled(key: AdminIntegrationKey): Promise<void> {
    const control = await this.getControl(key);
    if (control.effectiveEnabled) return;
    if (!control.deploymentAvailable) throw new PlatformChannelDeploymentUnavailableError(key);
    throw new PlatformChannelDisabledError(key);
  }
}

export function toPlatformChannelControl(
  key: AdminIntegrationKey,
  deploymentAvailable: boolean,
  row: { enabled: boolean; updatedAt: Date } | null,
): AdminIntegrationControl {
  const runtimeEnabled = row?.enabled ?? false;
  const effectiveEnabled = deploymentAvailable && runtimeEnabled;
  return {
    key,
    deploymentAvailable,
    runtimeEnabled,
    effectiveEnabled,
    state: !deploymentAvailable
      ? 'DEPLOYMENT_UNAVAILABLE'
      : effectiveEnabled
        ? 'ACTIVE'
        : 'ADMIN_DISABLED',
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
