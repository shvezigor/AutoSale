import { describe, expect, it, vi } from 'vitest';

import { TelegramService } from './telegram.service.js';

describe('Telegram supplier dispatch', () => {
  it('queues one privacy-safe supplier delivery for an approved order', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'delivery-1', status: 'PENDING' });
    const add = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111', status: 'APPROVED',
        tenant: { name: 'ФОП Швець Ігор Олександрович' },
        items: [{ catalogId: 'SKU-1', originalText: 'Двері Авангард', quantity: 2, size: '860x2050', color: 'білий' }],
      }) },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', name: 'Двері Авангард' }]) },
      telegramSupplierSetting: { findUnique: vi.fn().mockResolvedValue({ destinationId: 'destination-1' }) },
      telegramDelivery: { upsert },
    };

    await expect(new TelegramService(prisma as never, undefined, { botUsername: 'AutoSaleBot', queue: { add } })
      .queueSupplierOrder('tenant-1', '11111111-1111-4111-8111-111111111111')).resolves.toEqual({ deliveryId: 'delivery-1', status: 'PENDING' });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      purpose: 'SUPPLIER_ORDER', destinationId: 'destination-1', idempotencyKey: 'supplier-order:11111111-1111-4111-8111-111111111111',
      messageText: expect.stringContaining('SKU-1 — Двері Авангард'),
    }) }));
    const text = upsert.mock.calls[0]?.[0]?.create?.messageText as string;
    expect(text).toContain('Нове замовлення — ФОП Швець Ігор Олександрович #11111111');
    expect(text).not.toContain('AutoSale');
    expect(text).toContain('Кількість: 2');
    expect(text).not.toMatch(/телефон|адрес/i);
    expect(add).toHaveBeenCalledWith('telegram.deliver', { deliveryId: 'delivery-1' }, expect.any(Object));
  });

  it('rejects unapproved orders before creating a delivery', async () => {
    const upsert = vi.fn();
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', status: 'NEEDS_REVIEW', items: [] }) },
      telegramDelivery: { upsert },
    };

    await expect(new TelegramService(prisma as never, undefined, { botUsername: 'AutoSaleBot', queue: { add: vi.fn() } })
      .queueSupplierOrder('tenant-1', 'order-1')).rejects.toThrow('Approved order required');
    expect(upsert).not.toHaveBeenCalled();
  });
});
