import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CommercialSettingsService } from './commercial-settings.service.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

describe('CommercialSettingsService', () => {
  it('scopes legal entities and accounts to the authenticated tenant', async () => {
    const legalFindMany = vi.fn().mockResolvedValue([]);
    const accountFindMany = vi.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: vi.fn(),
      tenantLegalEntity: { findMany: legalFindMany },
      tenantBankAccount: { findMany: accountFindMany },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await service.list(tenantA);

    expect(legalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: tenantA } }));
    expect(accountFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: tenantA } }));
  });

  it('switches defaults inside one transaction', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({
      id: 'account', legalEntityId: 'entity', label: 'UAH', iban: 'UA000000000000000000000000000',
      bankName: null, currency: 'UAH', active: true, isDefault: true,
    });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLegalEntity: { findFirst: vi.fn().mockResolvedValue({ id: 'entity', tenantId: tenantA }) },
      tenantBankAccount: { updateMany, create },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await service.createBankAccount(tenantA, {
      legalEntityId: 'entity', label: 'UAH', iban: 'UA000000000000000000000000000', bankName: null,
      currency: 'UAH', active: true, isDefault: true,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: tenantA, legalEntityId: 'entity', currency: 'UAH', isDefault: true },
      data: { isDefault: false },
    });
  });

  it('does not expose or mutate an account from another tenant', async () => {
    const tx = { $queryRaw: vi.fn(), tenantBankAccount: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);
    await expect(service.accountDetail(tenantB, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate records to a safe conflict', async () => {
    const service = new CommercialSettingsService({ $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }) } as never);
    await expect(service.createLegalEntity(tenantA, {
      displayName: 'Main', legalName: 'Fictional Main LLC', type: 'COMPANY', registrationId: null, active: true, isDefault: false,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes an unused bank account inside the authenticated tenant', async () => {
    const remove = vi.fn().mockResolvedValue({ id: 'account-1' });
    const tx = {
      $queryRaw: vi.fn(),
      tenantBankAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'account-1' }),
        delete: remove,
      },
      orderCommercialTerms: { count: vi.fn().mockResolvedValue(0) },
      orderPayment: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await service.deleteBankAccount(tenantA, 'account-1');

    expect(tx.tenantBankAccount.findFirst).toHaveBeenCalledWith({ where: { id: 'account-1', tenantId: tenantA } });
    expect(remove).toHaveBeenCalledWith({ where: { id: 'account-1' } });
  });

  it('keeps a bank account that is referenced by an order or payment', async () => {
    const remove = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      tenantBankAccount: {
        findFirst: vi.fn().mockResolvedValue({ id: 'account-1' }),
        delete: remove,
      },
      orderCommercialTerms: { count: vi.fn().mockResolvedValue(1) },
      orderPayment: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await expect(service.deleteBankAccount(tenantA, 'account-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BANK_ACCOUNT_IN_USE' }),
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('requires bank accounts to be removed before deleting a legal entity', async () => {
    const remove = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      tenantLegalEntity: {
        findFirst: vi.fn().mockResolvedValue({ id: 'entity-1' }),
        delete: remove,
      },
      tenantBankAccount: { count: vi.fn().mockResolvedValue(1) },
      orderCommercialTerms: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await expect(service.deleteLegalEntity(tenantA, 'entity-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LEGAL_ENTITY_HAS_ACCOUNTS' }),
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes an unused legal entity inside the authenticated tenant', async () => {
    const remove = vi.fn().mockResolvedValue({ id: 'entity-1' });
    const tx = {
      $queryRaw: vi.fn(),
      tenantLegalEntity: {
        findFirst: vi.fn().mockResolvedValue({ id: 'entity-1' }),
        delete: remove,
      },
      tenantBankAccount: { count: vi.fn().mockResolvedValue(0) },
      orderCommercialTerms: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await service.deleteLegalEntity(tenantA, 'entity-1');

    expect(remove).toHaveBeenCalledWith({ where: { id: 'entity-1' } });
  });

  it('does not delete a legal entity from another tenant', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      tenantLegalEntity: { findFirst: vi.fn().mockResolvedValue(null), delete: vi.fn() },
      tenantBankAccount: { count: vi.fn() },
      orderCommercialTerms: { count: vi.fn() },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await expect(service.deleteLegalEntity(tenantB, 'entity-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.tenantLegalEntity.delete).not.toHaveBeenCalled();
  });
});
