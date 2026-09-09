import type { AuthPrincipal } from '@autosale/contracts/auth';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TelegramController } from './telegram.controller.js';

const manager: AuthPrincipal = {
  userId: 'manager', email: 'manager@example.com', name: 'Manager', platformRole: 'USER',
  tenantId: 'tenant', membershipRole: 'MANAGER', sessionId: 'session',
};
const owner: AuthPrincipal = { ...manager, userId: 'owner', membershipRole: 'OWNER' };

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

  it('shows supplier destinations to members but lets only the owner select one', async () => {
    const supplierSettings = vi.fn().mockResolvedValue({ destinations: [] });
    const saveSupplierSettings = vi.fn().mockResolvedValue({ selectedDestinationId: '11111111-1111-4111-8111-111111111111' });
    const controller = new TelegramController({ supplierSettings, saveSupplierSettings } as never);
    const input = { destinationId: '11111111-1111-4111-8111-111111111111', autoDispatch: false };

    await expect(controller.supplierSettings(manager)).resolves.toEqual({ destinations: [] });
    expect(() => controller.saveSupplierSettings(manager, input)).toThrow(ForbiddenException);
    await expect(controller.saveSupplierSettings(owner, input)).resolves.toMatchObject({ selectedDestinationId: input.destinationId });
    expect(saveSupplierSettings).toHaveBeenCalledWith('tenant', input);
  });

  it('queues an approved order for the configured supplier inside the current tenant', async () => {
    const queueSupplierOrder = vi.fn().mockResolvedValue({ deliveryId: 'delivery-1', status: 'PENDING' });
    const controller = new TelegramController({ queueSupplierOrder } as never);

    await expect(controller.sendSupplierOrder(manager, '11111111-1111-4111-8111-111111111111'))
      .resolves.toEqual({ deliveryId: 'delivery-1', status: 'PENDING' });
    expect(queueSupplierOrder).toHaveBeenCalledWith('tenant', '11111111-1111-4111-8111-111111111111');
  });
});
