import type { PrismaClient } from '@autosale/database';

export class InstagramSettingsService {
  constructor(private readonly prisma: PrismaClient) {}
  async get(tenantId: string) {
    const value = await this.prisma.instagramConnection.findUnique({ where: { tenantId }, select: { externalAccountId: true, displayName: true, status: true, updatedAt: true } });
    return value ? { ...value, updatedAt: value.updatedAt.toISOString() } : { externalAccountId: null, displayName: null, status: 'NOT_CONFIGURED' as const, updatedAt: null };
  }
  async update(tenantId: string, input: { externalAccountId: string; displayName?: string | null | undefined }) {
    const data = { externalAccountId: input.externalAccountId, ...(input.displayName !== undefined ? { displayName: input.displayName } : {}) };
    const value = await this.prisma.instagramConnection.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: { ...data, status: 'ACTIVE' }, select: { externalAccountId: true, displayName: true, status: true, updatedAt: true } });
    return { ...value, updatedAt: value.updatedAt.toISOString() };
  }
}
