import { describe, expect, it, vi } from 'vitest';

import { TelegramService } from './telegram.service.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const order = {
  id: orderId,
  status: 'APPROVED',
  supplierDispatchVersion: 0,
  tenant: { name: 'ФОП Швець Ігор Олександрович' },
  items: [
    { id: 'item-stock', procurementStatus: 'IN_STOCK', catalogId: 'STOCK', originalText: 'На складі', quantity: 1, size: null, color: null },
    { id: 'item-a', procurementStatus: 'TO_ORDER', catalogId: 'SKU-1', originalText: 'Двері Авангард', quantity: 2, size: '860x2050', color: 'білий' },
    { id: 'item-b', procurementStatus: 'TO_ORDER', catalogId: null, originalText: 'Ручка чорна', quantity: 1, size: null, color: 'чорний' },
  ],
};

describe('Telegram supplier dispatch', () => {
  it('previews and queues only supplier-order items with durable links', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const createDelivery = vi.fn().mockResolvedValue({ id: 'delivery-1', status: 'PENDING' });
    const createManyLinks = vi.fn().mockResolvedValue({ count: 2 });
    const markSending = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: orderId }]),
      order: {
        findFirst: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({ supplierDispatchVersion: 1 }),
      },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', name: 'Двері Авангард' }]) },
      telegramSupplierSetting: { findUnique: vi.fn().mockResolvedValue({ destinationId: 'destination-1', destination: { title: 'Постачальник дверей' } }) },
      telegramDelivery: { findFirst: vi.fn().mockResolvedValue(null), create: createDelivery },
      telegramDeliveryItem: { createMany: createManyLinks },
      orderItem: { updateMany: markSending },
    };
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(order) },
      product: transaction.product,
      telegramSupplierSetting: transaction.telegramSupplierSetting,
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = new TelegramService(prisma as never, undefined, { botUsername: 'AutoSaleBot', queue: { add } });

    const preview = await service.supplierOrderPreview('tenant-1', orderId);
    expect(preview).toMatchObject({
      orderId,
      companyName: 'ФОП Швець Ігор Олександрович',
      supplierName: 'Постачальник дверей',
      items: [{ orderItemId: 'item-a' }, { orderItemId: 'item-b' }],
    });
    expect(preview.items).toHaveLength(2);

    await expect(service.queueSupplierOrder('tenant-1', orderId))
      .resolves.toEqual({ deliveryId: 'delivery-1', status: 'PENDING' });
    expect(createDelivery).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'tenant-1', orderId, purpose: 'SUPPLIER_ORDER', destinationId: 'destination-1',
      idempotencyKey: `supplier-order:${orderId}:1`,
    }) }));
    const text = createDelivery.mock.calls[0]?.[0]?.data?.messageText as string;
    expect(text).toContain('Нове замовлення — ФОП Швець Ігор Олександрович #11111111');
    expect(text).toContain('SKU-1 — Двері Авангард');
    expect(text).toContain('Ручка чорна');
    expect(text).not.toContain('На складі');
    expect(text).not.toContain('AutoSale');
    expect(text).not.toMatch(/телефон|адрес/i);
    expect(createManyLinks).toHaveBeenCalledWith({ data: [
      { tenantId: 'tenant-1', deliveryId: 'delivery-1', orderItemId: 'item-a' },
      { tenantId: 'tenant-1', deliveryId: 'delivery-1', orderItemId: 'item-b' },
    ] });
    expect(markSending).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', id: { in: ['item-a', 'item-b'] }, procurementStatus: 'TO_ORDER' },
      data: expect.objectContaining({ procurementStatus: 'SENDING' }),
    }));
    expect(add).toHaveBeenCalledWith('telegram.deliver', { deliveryId: 'delivery-1' }, expect.any(Object));
  });

  it('returns the same active delivery on a duplicate click', async () => {
    const active = { id: 'delivery-active', status: 'PROCESSING' };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: orderId }]),
      telegramDelivery: { findFirst: vi.fn().mockResolvedValue(active), create: vi.fn() },
      order: { findFirst: vi.fn(), update: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)) };
    const add = vi.fn();

    await expect(new TelegramService(prisma as never, undefined, { botUsername: 'AutoSaleBot', queue: { add } })
      .queueSupplierOrder('tenant-1', orderId)).resolves.toEqual({ deliveryId: active.id, status: active.status });
    expect(transaction.telegramDelivery.create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('rejects an order without supplier-order items', async () => {
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ ...order, items: [order.items[0]] }) },
      telegramSupplierSetting: { findUnique: vi.fn().mockResolvedValue({ destination: { title: 'Supplier' } }) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };
    await expect(new TelegramService(prisma as never).supplierOrderPreview('tenant-1', orderId))
      .rejects.toThrow('No items require supplier ordering');
  });
});
