import { describe, expect, it, vi } from 'vitest';

import {
  AdminIntegrationService,
  AdminIntegrationUnavailableError,
} from './admin-integration.service.js';

const actorUserId = '11111111-1111-4111-8111-111111111111';
const updatedAt = new Date('2026-10-04T10:00:00.000Z');

describe('AdminIntegrationService', () => {
  it('lists both controls without exposing provider or tenant details', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ enabled: true, updatedAt })
      .mockResolvedValueOnce(null);
    const service = new AdminIntegrationService(
      { platformFeatureFlag: { findUnique } } as never,
      { FACEBOOK_MESSENGER: true, TIKTOK_BUSINESS_MESSAGING: true },
    );

    const result = await service.list();

    expect(result).toEqual([
      {
        key: 'FACEBOOK_MESSENGER', deploymentAvailable: true, runtimeEnabled: true,
        effectiveEnabled: true, state: 'ACTIVE', updatedAt: updatedAt.toISOString(),
      },
      {
        key: 'TIKTOK_BUSINESS_MESSAGING', deploymentAvailable: true, runtimeEnabled: false,
        effectiveEnabled: false, state: 'ADMIN_DISABLED', updatedAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret|credential|tenantId|pageId|accountId/i);
  });

  it('updates the flag and appends the success audit inside the same transaction', async () => {
    const transaction = {
      platformFeatureFlag: {
        findUnique: vi.fn().mockResolvedValue({ enabled: true }),
        upsert: vi.fn().mockResolvedValue({
          key: 'TIKTOK_BUSINESS_MESSAGING', enabled: false, updatedAt,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const appendAudit = vi.fn().mockResolvedValue(undefined);
    const service = new AdminIntegrationService(
      prisma as never,
      { FACEBOOK_MESSENGER: true, TIKTOK_BUSINESS_MESSAGING: true },
      appendAudit,
    );

    await expect(service.update(actorUserId, 'TIKTOK_BUSINESS_MESSAGING', { enabled: false }))
      .resolves.toMatchObject({ state: 'ADMIN_DISABLED', effectiveEnabled: false });
    expect(transaction.platformFeatureFlag.upsert).toHaveBeenCalledWith({
      where: { key: 'TIKTOK_BUSINESS_MESSAGING' },
      create: {
        key: 'TIKTOK_BUSINESS_MESSAGING', enabled: false, updatedByUserId: actorUserId,
      },
      update: { enabled: false, updatedByUserId: actorUserId },
      select: { enabled: true, updatedAt: true },
    });
    expect(appendAudit).toHaveBeenCalledWith(transaction, {
      tenantId: null,
      userId: actorUserId,
      actor: 'USER',
      action: 'PLATFORM_SOCIAL_CHANNEL_STATE_CHANGED',
      result: 'SUCCESS',
      metadata: {
        channel: 'TIKTOK_BUSINESS_MESSAGING',
        previousEnabled: true,
        enabled: false,
      },
    });
  });

  it('does not mutate state and audits a rejected enable when deployment is unavailable', async () => {
    const prisma = {
      $transaction: vi.fn(),
      platformFeatureFlag: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    const appendAudit = vi.fn().mockResolvedValue(undefined);
    const service = new AdminIntegrationService(
      prisma as never,
      { FACEBOOK_MESSENGER: false, TIKTOK_BUSINESS_MESSAGING: true },
      appendAudit,
    );

    await expect(service.update(actorUserId, 'FACEBOOK_MESSENGER', { enabled: true }))
      .rejects.toBeInstanceOf(AdminIntegrationUnavailableError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.platformFeatureFlag.upsert).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(prisma, {
      tenantId: null,
      userId: actorUserId,
      actor: 'USER',
      action: 'PLATFORM_SOCIAL_CHANNEL_STATE_CHANGED',
      result: 'FAILURE',
      metadata: {
        channel: 'FACEBOOK_MESSENGER',
        enabled: true,
        reason: 'DEPLOYMENT_UNAVAILABLE',
      },
    });
  });

  it('propagates audit failure so the enclosing transaction can roll back', async () => {
    const transaction = {
      platformFeatureFlag: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          key: 'FACEBOOK_MESSENGER', enabled: true, updatedAt,
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    };
    const service = new AdminIntegrationService(
      prisma as never,
      { FACEBOOK_MESSENGER: true, TIKTOK_BUSINESS_MESSAGING: true },
      vi.fn().mockRejectedValue(new Error('audit unavailable')),
    );

    await expect(service.update(actorUserId, 'FACEBOOK_MESSENGER', { enabled: true }))
      .rejects.toThrow('audit unavailable');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
