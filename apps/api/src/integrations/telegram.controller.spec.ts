import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TelegramController } from './telegram.controller.js';

const manager: AuthPrincipal = {
  userId: 'manager', email: 'manager@example.com', name: 'Manager', platformRole: 'USER',
  tenantId: 'tenant', membershipRole: 'MANAGER', sessionId: 'session',
};

describe('TelegramController', () => {
  it('allows personal linking for a member but reserves supplier groups for owners', async () => {
    const startLink = vi.fn().mockResolvedValue({ url: 'https://t.me/AutoSaleBot?start=token', expiresAt: '2026-09-08T12:05:00.000Z' });
    const controller = new TelegramController({ startLink } as never);

    await controller.link(manager, { purpose: 'PERSONAL' });
    expect(() => controller.link(manager, { purpose: 'SUPPLIER_GROUP' })).toThrow(ForbiddenException);
    expect(startLink).toHaveBeenCalledTimes(1);
  });

  it('queues a test notification for the current member only', async () => {
    const queueTest = vi.fn().mockResolvedValue({ deliveryId: 'delivery-id', status: 'PENDING' });
    const controller = new TelegramController({ queueTest } as never);

    await expect(controller.test(manager)).resolves.toEqual({ deliveryId: 'delivery-id', status: 'PENDING' });
    expect(queueTest).toHaveBeenCalledWith('tenant', 'manager');
  });

  it('returns a safe client error when the personal Telegram connection is missing', async () => {
    const queueTest = vi.fn().mockRejectedValue(new Error('Telegram personal connection required'));
    const controller = new TelegramController({ queueTest } as never);

    await expect(controller.test(manager)).rejects.toBeInstanceOf(BadRequestException);
  });
});
