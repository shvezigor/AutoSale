import { z } from 'zod';

export const moneyStringSchema = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/);
export const currencyCodeSchema = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
export const legalEntityTypeSchema = z.enum(['COMPANY', 'SOLE_PROPRIETOR', 'OTHER']);
export const commercialPricingStatusSchema = z.enum(['READY', 'NEEDS_REVIEW']);
export const commercialIssueCodeSchema = z.enum(['ITEM_PRICE_MISSING', 'ITEM_CURRENCY_MISSING', 'MIXED_CURRENCIES']);

const normalizedIbanSchema = z.string()
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/));

export const legalEntityInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().min(1).max(240),
  type: legalEntityTypeSchema,
  registrationId: z.string().trim().min(1).max(64).nullable(),
  active: z.boolean(),
  isDefault: z.boolean(),
}).strict();

export const bankAccountInputSchema = z.object({
  legalEntityId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  iban: normalizedIbanSchema,
  bankName: z.string().trim().min(1).max(160).nullable().optional().default(null),
  currency: currencyCodeSchema,
  active: z.boolean(),
  isDefault: z.boolean(),
}).strict();

export const commercialTermsUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  legalEntityId: z.string().uuid().nullable(),
  bankAccountId: z.string().uuid().nullable(),
  initializeLegacy: z.boolean().optional().default(false),
}).strict();

export type LegalEntityType = z.infer<typeof legalEntityTypeSchema>;
export type CommercialPricingStatus = z.infer<typeof commercialPricingStatusSchema>;
export type CommercialIssueCode = z.infer<typeof commercialIssueCodeSchema>;
export type LegalEntityInput = z.infer<typeof legalEntityInputSchema>;
export type BankAccountInput = z.infer<typeof bankAccountInputSchema>;
export type CommercialTermsUpdate = z.infer<typeof commercialTermsUpdateSchema>;

export interface LegalEntitySummary {
  id: string;
  displayName: string;
  legalName: string;
  type: LegalEntityType;
  registrationId: string | null;
  active: boolean;
  isDefault: boolean;
}

export interface BankAccountSummary {
  id: string;
  legalEntityId: string;
  label: string;
  maskedIban: string;
  bankName: string | null;
  currency: string;
  active: boolean;
  isDefault: boolean;
}

export interface BankAccountDetail extends BankAccountSummary {
  iban: string;
}

export interface CommercialSettingsSummary {
  legalEntities: LegalEntitySummary[];
  bankAccounts: BankAccountSummary[];
}

export interface OrderCommercialTermsSummary {
  pricingStatus: CommercialPricingStatus;
  issueCodes: CommercialIssueCode[];
  currency: string | null;
  itemsSubtotal: string | null;
  discountAmount: string;
  deliveryAmount: string;
  totalAmount: string | null;
  legalEntity: LegalEntitySummary | null;
  bankAccount: BankAccountSummary | null;
  eligibleAccounts: BankAccountSummary[];
  version: number;
  legacy: boolean;
}
