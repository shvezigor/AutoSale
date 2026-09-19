import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@autosale/database';
import { describe, expect, it, vi } from 'vitest';

import { OrdersService } from './orders.service.js';

describe('OrdersService Google Sheets retry', () => {
  it('uses the current Instagram profile in order summaries and customer data', async () => {
    const row = {
      id: 'order-1', publicNumber: 'AS-260918', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', extraction: {
        customer: { name: 'Ігор', phone: '+380976536783', instagramUsername: null },
      }, validationIssues: [], overallConfidence: 0.8,
      createdAt: new Date('2026-09-07T10:00:00.000Z'),
      conversation: {
        displayName: null, channel: 'INSTAGRAM',
        profile: { displayName: 'Davida Shvets', username: 'davidashvets' },
      },
      intentEvaluation: { mode: 'AI_SUGGESTION', reason: 'MANAGER_REVIEW_MODE' },
      items: [], exports: [],
    };
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(1) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new OrdersService(prisma as never).list('tenant-1', { page: 1, pageSize: 25 });

    expect(result.items[0]).toMatchObject({
      publicNumber: 'AS-260918',
      participantName: 'Davida Shvets',
      customer: { name: 'Ігор', phone: '+380976536783', instagramUsername: 'davidashvets' },
      intentDetection: { mode: 'AI_SUGGESTION', reason: 'MANAGER_REVIEW_MODE' },
    });
    expect(result).toMatchObject({ page: 1, pageSize: 25, total: 1 });
  });

  it('reopens an auto-approved order for review and releases its stock reservation after correction', async () => {
    const current = {
      id: 'order-1', publicNumber: 'AS-260918', tenantId: 'tenant-1', status: 'AUTO_APPROVED', extraction: {
        isOrder: true,
        customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
        delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' },
      },
      validationIssues: [], overallConfidence: 1, createdAt: new Date('2026-09-18T19:10:00.000Z'),
      conversation: { displayName: 'Олена', channel: 'INSTAGRAM', profile: null },
      items: [{ id: 'item-1', catalogId: 'SKU-1', originalText: 'Товар', quantity: 1, color: null, size: null, confidence: 1, reservation: { id: 'reservation-1', quantity: 1, status: 'ACTIVE' }, unitPriceSnapshot: new Prisma.Decimal('4395.00'), currencySnapshot: 'UAH', lineTotalSnapshot: new Prisma.Decimal('4395.00'), priceSourceSku: 'SKU-1' }],
      exports: [], procurementHandedOffAt: null, telegramDeliveries: [], shipments: [], intentEvaluation: null,
      commercialTerms: { id: 'terms-1', legalEntityId: null, bankAccountId: null, pricingStatus: 'READY', issueCodes: [], currency: 'UAH', itemsSubtotal: new Prisma.Decimal('4395.00'), discountAmount: new Prisma.Decimal(0), deliveryAmount: new Prisma.Decimal(0), totalAmount: new Prisma.Decimal('4395.00'), version: 1, legalEntity: null, bankAccount: null },
    };
    const reopened = { ...current, status: 'NEEDS_REVIEW', items: [{ ...current.items[0], quantity: 2, reservation: null }] };
    const termsUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(current) },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', name: 'Товар', price: new Prisma.Decimal('9999.00'), currency: 'UAH' }]) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        orderItem: { update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        orderCommercialTerms: { upsert: termsUpsert },
        inventoryReservation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        order: { update: vi.fn().mockResolvedValue(reopened) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })),
    };
    const procurement = {
      assessApprovedOrder: vi.fn(),
      releaseOrderReservations: vi.fn().mockResolvedValue(undefined),
    };

    const result = await new OrdersService(prisma as never, procurement as never).update('tenant-1', 'order-1', 'manager-1', {
      items: [{ id: 'item-1', catalogId: 'SKU-1', quantity: 2, color: null, size: null }],
    });

    expect(result).toMatchObject({ status: 'NEEDS_REVIEW', items: [{ quantity: 2 }] });
    expect(termsUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ itemsSubtotal: '8790.00', totalAmount: '8790.00' }),
    }));
  });

  it('paginates and filters orders inside the authenticated tenant', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      order: { findMany, count },
      product: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new OrdersService(prisma as never).list('tenant-a', {
      search: 'Авангард',
      status: 'NEEDS_REVIEW',
      procurementStatus: 'NEEDS_ORDER',
      page: 2,
      pageSize: 10,
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        status: 'NEEDS_REVIEW',
        AND: [expect.objectContaining({ items: {
          some: { procurementStatus: 'TO_ORDER' },
          every: { procurementStatus: 'TO_ORDER' },
        } })],
      }),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
    }));
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({
      tenantId: 'tenant-a',
      status: 'NEEDS_REVIEW',
      AND: [expect.objectContaining({ items: {
        some: { procurementStatus: 'TO_ORDER' },
        every: { procurementStatus: 'TO_ORDER' },
      } })],
    }) });
    expect(result).toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
  });

  it('sorts projected customer names and nullable confidence in the database', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { findMany, count: vi.fn().mockResolvedValue(0) }, product: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new OrdersService(prisma as never);
    await service.list('tenant-a', { page: 1, pageSize: 25, sort: 'customer', direction: 'asc' });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ sortCustomer: 'asc' }, { id: 'asc' }] }));
    await service.list('tenant-a', { page: 1, pageSize: 25, sort: 'confidence', direction: 'desc' });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ overallConfidence: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }] }));
  });

  it('returns the pending Sheets export immediately after approval', async () => {
    const baseOrder = {
      id: 'order-1', tenantId: 'tenant-1', status: 'NEEDS_REVIEW', extraction: {
        isOrder: true,
        customer: { name: 'Олена', phone: '+380671234567', instagramUsername: 'olena' },
        delivery: { city: 'Київ', address: null, novaPoshtaBranch: '24' },
      }, validationIssues: [],
      overallConfidence: 1, createdAt: new Date('2026-09-07T10:00:00.000Z'),
      conversation: { displayName: 'Олена', channel: 'INSTAGRAM' },
      items: [{ id: 'item-1', catalogId: 'SKU-1', originalText: 'Товар', quantity: 1, color: null, size: null, confidence: 1 }],
      exports: [],
    };
    const pendingExport = {
      status: 'PENDING', attempts: 0, rowNumber: null, lastAttemptAt: null, lastSyncedAt: null,
      errorSummary: null, destination: { status: 'ACTIVE' },
    };
    const approvedOrder = { ...baseOrder, status: 'APPROVED' };
    const findFirst = vi.fn()
      .mockResolvedValueOnce(baseOrder)
      .mockResolvedValueOnce({ ...approvedOrder, exports: [pendingExport] });
    const upsert = vi.fn().mockResolvedValue(pendingExport);
    const prisma = {
      order: { findFirst },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', name: 'Товар' }]) },
      googleSheetsDestination: { findUnique: vi.fn().mockResolvedValue({ id: 'destination-1', status: 'ACTIVE' }) },
      orderExport: { upsert },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        order: { update: vi.fn().mockResolvedValue(approvedOrder) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })),
    };
    const procurement = {
      assessApprovedOrder: vi.fn().mockResolvedValue({ orderId: 'order-1', summary: 'READY', items: [] }),
      releaseOrderReservations: vi.fn(),
    };

    const result = await new OrdersService(prisma as never, procurement as never)
      .approve('tenant-1', 'order-1', 'manager-1');

    expect(procurement.assessApprovedOrder).toHaveBeenCalledWith('tenant-1', 'order-1', 'manager-1');
    expect(upsert).toHaveBeenCalled();
    expect(result.status).toBe('APPROVED');
    expect(result.sheetsExport).toMatchObject({ status: 'PENDING', retryAllowed: false });
  });

  it('releases active reservations when an order is cancelled', async () => {
    const baseOrder = {
      id: 'order-1', tenantId: 'tenant-1', status: 'APPROVED', extraction: {},
      validationIssues: [], overallConfidence: 1, createdAt: new Date(),
      conversation: { displayName: 'Customer', channel: 'INSTAGRAM', profile: null },
      items: [], exports: [], procurementHandedOffAt: null, telegramDeliveries: [],
    };
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue(baseOrder) },
      product: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        order: { update: vi.fn().mockResolvedValue({ ...baseOrder, status: 'CANCELLED' }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })),
    };
    const procurement = {
      assessApprovedOrder: vi.fn(),
      releaseOrderReservations: vi.fn().mockResolvedValue(undefined),
    };

    await new OrdersService(prisma as never, procurement as never)
      .cancel('tenant-1', 'order-1', 'manager-1');

    expect(procurement.releaseOrderReservations).toHaveBeenCalledWith('tenant-1', 'order-1', 'manager-1');
  });

  it('moves one failed export back to pending when its destination is active', async () => {
    const update = vi.fn().mockResolvedValue({ status: 'PENDING', attempts: 2, rowNumber: null, lastAttemptAt: null, lastSyncedAt: null, errorSummary: null });
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', exports: [], items: [], conversation: {} }) },
      orderExport: { findFirst: vi.fn().mockResolvedValue({ id: 'export-1', status: 'FAILED', destination: { status: 'ACTIVE' } }), update },
    };
    const result = await new OrdersService(prisma as never).retrySheetsExport('tenant-1', 'order-1');
    expect(result.status).toBe('PENDING');
    expect(result.retryAllowed).toBe(false);
    expect(update).toHaveBeenCalledWith({ where: { id: 'export-1' }, data: { status: 'PENDING', errorSummary: null } });
  });

  it('blocks retry while the destination configuration is invalid', async () => {
    const update = vi.fn();
    const prisma = {
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order-1', exports: [], items: [], conversation: {} }) },
      orderExport: { findFirst: vi.fn().mockResolvedValue({ id: 'export-1', status: 'FAILED', destination: { status: 'ERROR' } }), update },
    };
    await expect(new OrdersService(prisma as never).retrySheetsExport('tenant-1', 'order-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 404 before mutating an order from another tenant', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { order: { findFirst }, orderExport: { findFirst: vi.fn(), update: vi.fn() } };

    await expect(new OrdersService(prisma as never).retrySheetsExport('tenant-b', 'order-a'))
      .rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'order-a', tenantId: 'tenant-b' } }));
    expect(prisma.orderExport.findFirst).not.toHaveBeenCalled();
  });
});
