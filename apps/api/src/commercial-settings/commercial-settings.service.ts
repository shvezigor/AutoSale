import type {
  BankAccountDetail,
  BankAccountInput,
  BankAccountSummary,
  CommercialSettingsSummary,
  LegalEntityInput,
  LegalEntitySummary,
} from '@autosale/contracts/commercial';
import type { PrismaClient } from '@autosale/database';
import { ConflictException, NotFoundException } from '@nestjs/common';

export class CommercialSettingsService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string): Promise<CommercialSettingsSummary> {
    const [legalEntities, bankAccounts] = await Promise.all([
      this.prisma.tenantLegalEntity.findMany({ where: { tenantId }, orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }] }),
      this.prisma.tenantBankAccount.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { currency: 'asc' }, { label: 'asc' }] }),
    ]);
    return {
      legalEntities: legalEntities.map(mapLegalEntity),
      bankAccounts: bankAccounts.map(mapBankAccount),
    };
  }

  async accountDetail(tenantId: string, id: string): Promise<BankAccountDetail> {
    const account = await this.prisma.tenantBankAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Bank account not found');
    return { ...mapBankAccount(account), iban: account.iban };
  }

  async createLegalEntity(tenantId: string, input: LegalEntityInput): Promise<LegalEntitySummary> {
    try {
      const entity = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.tenantLegalEntity.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
        }
        return tx.tenantLegalEntity.create({ data: { ...input, tenantId } });
      });
      return mapLegalEntity(entity);
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async updateLegalEntity(tenantId: string, id: string, input: LegalEntityInput): Promise<LegalEntitySummary> {
    const entity = await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantLegalEntity.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException('Legal entity not found');
      if (!input.active && current.isDefault) throw new ConflictException('Select another default legal entity first');
      if (input.isDefault) {
        await tx.tenantLegalEntity.updateMany({ where: { tenantId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      }
      return tx.tenantLegalEntity.update({ where: { id }, data: input });
    }).catch((error: unknown) => this.mapConflict(error));
    return mapLegalEntity(entity);
  }

  async deleteLegalEntity(tenantId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantLegalEntity.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException('Legal entity not found');
      const bankAccountCount = await tx.tenantBankAccount.count({ where: { tenantId, legalEntityId: id } });
      if (bankAccountCount > 0) throw commercialConflict('LEGAL_ENTITY_HAS_ACCOUNTS');
      const historicalUseCount = await tx.orderCommercialTerms.count({ where: { tenantId, legalEntityId: id } });
      if (historicalUseCount > 0) throw commercialConflict('LEGAL_ENTITY_IN_USE');
      await tx.tenantLegalEntity.delete({ where: { id } });
    }).catch((error: unknown) => this.mapDeleteConflict(error, 'LEGAL_ENTITY_IN_USE'));
  }

  async createBankAccount(tenantId: string, input: BankAccountInput): Promise<BankAccountSummary> {
    try {
      const account = await this.prisma.$transaction(async (tx) => {
        await this.requireLegalEntity(tx, tenantId, input.legalEntityId);
        if (input.isDefault) {
          await tx.tenantBankAccount.updateMany({
            where: { tenantId, legalEntityId: input.legalEntityId, currency: input.currency, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.tenantBankAccount.create({
          data: { ...input, tenantId, normalizedIban: normalizeIban(input.iban), isDefault: input.active && input.isDefault },
        });
      });
      return mapBankAccount(account);
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async updateBankAccount(tenantId: string, id: string, input: BankAccountInput): Promise<BankAccountSummary> {
    const account = await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantBankAccount.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException('Bank account not found');
      await this.requireLegalEntity(tx, tenantId, input.legalEntityId);
      if (input.isDefault && input.active) {
        await tx.tenantBankAccount.updateMany({
          where: { tenantId, legalEntityId: input.legalEntityId, currency: input.currency, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.tenantBankAccount.update({
        where: { id },
        data: { ...input, normalizedIban: normalizeIban(input.iban), isDefault: input.active && input.isDefault },
      });
    }).catch((error: unknown) => this.mapConflict(error));
    return mapBankAccount(account);
  }

  async deleteBankAccount(tenantId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.tenantBankAccount.findFirst({ where: { id, tenantId } });
      if (!current) throw new NotFoundException('Bank account not found');
      const [commercialTermsCount, paymentCount] = await Promise.all([
        tx.orderCommercialTerms.count({ where: { tenantId, bankAccountId: id } }),
        tx.orderPayment.count({ where: { tenantId, bankAccountId: id } }),
      ]);
      if (commercialTermsCount > 0 || paymentCount > 0) throw commercialConflict('BANK_ACCOUNT_IN_USE');
      await tx.tenantBankAccount.delete({ where: { id } });
    }).catch((error: unknown) => this.mapDeleteConflict(error, 'BANK_ACCOUNT_IN_USE'));
  }

  private async requireLegalEntity(
    tx: Pick<PrismaClient, 'tenantLegalEntity'>,
    tenantId: string,
    id: string,
  ): Promise<void> {
    const entity = await tx.tenantLegalEntity.findFirst({ where: { id, tenantId } });
    if (!entity) throw new NotFoundException('Legal entity not found');
  }

  private mapConflict(error: unknown): never {
    if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
    if (isPrismaUniqueError(error)) throw new ConflictException('Commercial settings record already exists');
    throw error;
  }

  private mapDeleteConflict(error: unknown, fallbackCode: CommercialDeleteConflictCode): never {
    if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
    if (isPrismaForeignKeyError(error)) throw commercialConflict(fallbackCode);
    throw error;
  }
}

type CommercialDeleteConflictCode = 'LEGAL_ENTITY_HAS_ACCOUNTS' | 'LEGAL_ENTITY_IN_USE' | 'BANK_ACCOUNT_IN_USE';

function commercialConflict(code: CommercialDeleteConflictCode): ConflictException {
  return new ConflictException({ code, message: code });
}

function mapLegalEntity(entity: {
  id: string; displayName: string; legalName: string; type: string; registrationId: string | null; active: boolean; isDefault: boolean;
}): LegalEntitySummary {
  return { ...entity, type: entity.type as LegalEntitySummary['type'] };
}

function mapBankAccount(account: {
  id: string; legalEntityId: string; label: string; iban: string; bankName: string | null; currency: string; active: boolean; isDefault: boolean;
}): BankAccountSummary {
  return {
    id: account.id,
    legalEntityId: account.legalEntityId,
    label: account.label,
    maskedIban: maskIban(account.iban),
    bankName: account.bankName,
    currency: account.currency,
    active: account.active,
    isDefault: account.isDefault,
  };
}

function normalizeIban(value: string): string {
  return value.replace(/\s/g, '').toUpperCase();
}

function maskIban(value: string): string {
  const normalized = normalizeIban(value);
  return `${normalized.slice(0, 2)}••••${normalized.slice(-4)}`;
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function isPrismaForeignKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003';
}
