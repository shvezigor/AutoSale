import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CommercialSettingsService } from './commercial-settings.service.js';

describe('CommercialSettingsService', () => {
  it('scopes legal entities and accounts to the authenticated tenant', async () => {
    const legalFindMany = vi.fn().mockResolvedValue([]);
    const accountFindMany = vi.fn().mockResolvedValue([]);
    const service = new CommercialSettingsService({
      tenantLegalEntity: { findMany: legalFindMany },
      tenantBankAccount: { findMany: accountFindMany },
    } as never);

    await service.list('tenant-a');

    expect(legalFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
    expect(accountFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
  });

  it('switches defaults inside one transaction', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({
      id: 'account', legalEntityId: 'entity', label: 'UAH', iban: 'UA000000000000000000000000000',
      bankName: null, currency: 'UAH', active: true, isDefault: true,
    });
    const tx = {
      tenantLegalEntity: { findFirst: vi.fn().mockResolvedValue({ id: 'entity', tenantId: 'tenant-a' }) },
      tenantBankAccount: { updateMany, create },
    };
    const service = new CommercialSettingsService({ $transaction: vi.fn((operation) => operation(tx)) } as never);

    await service.createBankAccount('tenant-a', {
      legalEntityId: 'entity', label: 'UAH', iban: 'UA000000000000000000000000000', bankName: null,
      currency: 'UAH', active: true, isDefault: true,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', legalEntityId: 'entity', currency: 'UAH', isDefault: true },
      data: { isDefault: false },
    });
  });

  it('does not expose or mutate an account from another tenant', async () => {
    const service = new CommercialSettingsService({ tenantBankAccount: { findFirst: vi.fn().mockResolvedValue(null) } } as never);
    await expect(service.accountDetail('tenant-b', '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps duplicate records to a safe conflict', async () => {
    const service = new CommercialSettingsService({ $transaction: vi.fn().mockRejectedValue({ code: 'P2002' }) } as never);
    await expect(service.createLegalEntity('tenant-a', {
      displayName: 'Main', legalName: 'Fictional Main LLC', type: 'COMPANY', registrationId: null, active: true, isDefault: false,
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
