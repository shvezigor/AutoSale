import { describe, expect, it, vi } from 'vitest';
import { assertTenantAcceptingMutations, Prisma, TenantLifecycleFrozenError } from '@autosale/database';

import { TikTokEventService } from './tiktok-event.service.js';

vi.mock('@autosale/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@autosale/database')>();
  return {
    ...actual,
    assertTenantAcceptingMutations: vi.fn().mockResolvedValue(undefined),
    withTenantTransaction: <T>(prisma: any, _tenantId: string, operation: (transaction: unknown) => Promise<T>) =>
      prisma.$transaction(operation),
  };
});

describe('TikTokEventService', () => {
  it('resolves only an active or inbound-only unexpired account mapping', async () => {
    const connection = {
      tenantId: 'tenant-a', status: 'INBOUND_ONLY', tokenExpiresAt: new Date('2026-10-05T00:00:00.000Z'),
    };
    const transaction = {
      tikTokConnection: {
        findUnique: vi.fn().mockResolvedValue(connection),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma: any = {
      $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: 'tenant-a' }]),
      $transaction: async (operation: any) => operation(transaction),
    };
    const service = new TikTokEventService(prisma, () => new Date('2026-10-04T20:00:00.000Z'));
    await expect(service.resolveTenant('fictional-account')).resolves.toBe('tenant-a');

    connection.tokenExpiresAt = new Date('2026-10-04T19:59:59.000Z');
    await expect(service.resolveTenant('fictional-account')).resolves.toBeNull();
    expect(transaction.tikTokConnection.updateMany).toHaveBeenCalled();
  });

  it('stores a sanitized TikTok event and returns the durable id', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-a' });
    const prisma: any = { $transaction: async (operation: any) => operation({ webhookEvent: { create } }) };
    const service = new TikTokEventService(prisma);
    await expect(service.register({
      tenantId: 'tenant-a', externalEventId: 'tiktok:message-a',
      payload: { event: 'im_receive_msg', access_token: 'must-not-remain' },
    })).resolves.toEqual({ eventId: 'event-a', duplicate: false, pending: true });
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain('must-not-remain');
  });

  it('returns the same pending durable event for duplicate provider delivery', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'test',
    });
    const transaction = {
      webhookEvent: {
        create: vi.fn().mockRejectedValue(duplicate),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'event-a', status: 'RECEIVED' }),
      },
    };
    const prisma: any = { $transaction: async (operation: any) => operation(transaction) };
    const service = new TikTokEventService(prisma);

    await expect(service.register({
      tenantId: 'tenant-a', externalEventId: 'tiktok:message-a', payload: { event: 'im_receive_msg' },
    })).resolves.toEqual({ eventId: 'event-a', duplicate: true, pending: true });
  });

  it('acknowledges a lifecycle-frozen tenant without retaining customer content', async () => {
    vi.mocked(assertTenantAcceptingMutations).mockRejectedValueOnce(new TenantLifecycleFrozenError('META_INBOUND'));
    const create = vi.fn();
    const prisma: any = { $transaction: async (operation: any) => operation({ webhookEvent: { create } }) };
    const service = new TikTokEventService(prisma);

    await expect(service.register({
      tenantId: 'tenant-a', externalEventId: 'tiktok:message-frozen', payload: { content: 'customer content' },
    })).resolves.toEqual({ eventId: null, duplicate: false, pending: false, frozen: true });
    expect(create).not.toHaveBeenCalled();
  });
});
