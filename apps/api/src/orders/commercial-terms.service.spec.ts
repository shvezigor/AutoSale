import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CommercialTermsService } from './commercial-terms.service.js';

describe('CommercialTermsService', () => {
  it('previews a legacy order without writing and requests only eligible accounts', async () => {
    const transaction = vi.fn();
    const bankFindMany = vi.fn().mockResolvedValue([]);
    const service = new CommercialTermsService({
      order: { findFirst: vi.fn().mockResolvedValue({
        id: 'order', tenantId: 'tenant', procurementHandedOffAt: null, telegramDeliveries: [], shipments: [],
        items: [{ id: 'item', catalogId: 'SKU-1', quantity: 2 }],
      }) },
      product: { findMany: vi.fn().mockResolvedValue([{ sku: 'SKU-1', price: { toFixed: () => '10.00' }, currency: 'UAH' }]) },
      tenantLegalEntity: { findFirst: vi.fn().mockResolvedValue({
        id: 'entity', displayName: 'Main', legalName: 'Fictional LLC', type: 'COMPANY', registrationId: null, active: true, isDefault: true,
      }) },
      tenantBankAccount: { findMany: bankFindMany },
      $transaction: transaction,
    } as never);

    await expect(service.preview('tenant', 'order')).resolves.toMatchObject({
      pricingStatus: 'READY', currency: 'UAH', totalAmount: '20.00', legacy: true,
    });
    expect(bankFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant', legalEntityId: 'entity', currency: 'UAH', active: true },
    }));
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale commercial terms version', async () => {
    const service = new CommercialTermsService({
      order: { findFirst: vi.fn().mockResolvedValue({ id: 'order', procurementHandedOffAt: null, telegramDeliveries: [], shipments: [] }) },
      orderCommercialTerms: { findFirst: vi.fn().mockResolvedValue({ version: 3 }) },
    } as never);

    await expect(service.update('tenant', 'order', 'manager', {
      version: 2, legalEntityId: null, bankAccountId: null, initializeLegacy: false,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks commercial selections while an active payment exists', async () => {
    const updateMany = vi.fn();
    const service = new CommercialTermsService({
      order: { findFirst: vi.fn().mockResolvedValue({
        id: 'order', procurementHandedOffAt: null, telegramDeliveries: [], shipments: [], items: [],
      }) },
      orderCommercialTerms: { findFirst: vi.fn().mockResolvedValue({ version: 1, currency: 'UAH' }) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        orderPayment: { count: vi.fn().mockResolvedValue(1) },
        orderCommercialTerms: { updateMany },
      })),
    } as never);

    await expect(service.update('tenant', 'order', 'manager', {
      version: 1, legalEntityId: null, bankAccountId: null, initializeLegacy: false,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows updating commercial terms when Telegram only sent a personal alert', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const delivery = { purpose: 'PERSONAL_ALERT', status: 'SUCCEEDED' };
    const service = new CommercialTermsService({
      order: { findFirst: vi.fn().mockImplementation(({ include }) => Promise.resolve({
        id: 'order', procurementHandedOffAt: null, shipments: [],
        telegramDeliveries: include.telegramDeliveries.where?.purpose === 'SUPPLIER_ORDER' ? [] : [delivery],
      })) },
      orderCommercialTerms: { findFirst: vi.fn()
        .mockResolvedValueOnce({ id: 'terms', version: 1, currency: 'UAH' })
        .mockResolvedValueOnce({
          id: 'terms', version: 2, pricingStatus: 'READY', issueCodes: [], currency: 'UAH',
          itemsSubtotal: { toFixed: () => '10.00' }, discountAmount: { toFixed: () => '0.00' },
          deliveryAmount: { toFixed: () => '0.00' }, totalAmount: { toFixed: () => '10.00' },
          legalEntityId: null, legalEntity: null, bankAccount: null,
        }) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        orderPayment: { count: vi.fn().mockResolvedValue(0) },
        orderCommercialTerms: { updateMany },
        auditLog: { create: vi.fn() },
      })),
    } as never);

    await expect(service.update('tenant', 'order', 'manager', {
      version: 1, legalEntityId: null, bankAccountId: null, initializeLegacy: false,
    })).resolves.toMatchObject({ version: 2, totalAmount: '10.00' });
  });

  it('rejects commercial changes after an order was sent to a supplier', async () => {
    const service = new CommercialTermsService({
      order: { findFirst: vi.fn().mockResolvedValue({
        id: 'order', procurementHandedOffAt: null, shipments: [],
        telegramDeliveries: [{ purpose: 'SUPPLIER_ORDER', status: 'SUCCEEDED' }],
      }) },
    } as never);

    await expect(service.update('tenant', 'order', 'manager', {
      version: 1, legalEntityId: null, bankAccountId: null, initializeLegacy: false,
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
