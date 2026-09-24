import type {
  BankAccountDetail,
  BankAccountInput,
  BankAccountSummary,
  LegalEntityInput,
  LegalEntitySummary,
} from '../../../../packages/contracts/src/commercial';

import { mutatingFetch } from '../auth/csrf-fetch';
import {
  parseValidationFailure,
  ValidationApiError,
  type ClientValidationIssueAllowlist,
} from './validation-errors';

const commercialIssueAllowlist = {
  displayName: ['INVALID_DISPLAY_NAME'],
  legalName: ['INVALID_LEGAL_NAME'],
  type: ['INVALID_LEGAL_ENTITY_TYPE'],
  registrationId: ['INVALID_REGISTRATION_ID'],
  active: ['INVALID_ACTIVE_FLAG'],
  isDefault: ['INVALID_DEFAULT_FLAG'],
  legalEntityId: ['INVALID_LEGAL_ENTITY'],
  label: ['INVALID_ACCOUNT_LABEL'],
  iban: ['INVALID_IBAN'],
  bankName: ['INVALID_BANK_NAME'],
  currency: ['INVALID_CURRENCY'],
} as const satisfies ClientValidationIssueAllowlist;

const commercialErrorCodes = ['LEGAL_ENTITY_HAS_ACCOUNTS', 'LEGAL_ENTITY_IN_USE', 'BANK_ACCOUNT_IN_USE'] as const;
export type CommercialSettingsErrorCode = typeof commercialErrorCodes[number];

export class CommercialSettingsApiError extends Error {
  constructor(readonly status: number, readonly code: CommercialSettingsErrorCode | null) {
    super(`Commercial settings API returned HTTP ${status}`);
    this.name = 'CommercialSettingsApiError';
  }
}

async function mutation<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await mutatingFetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await parseValidationFailure(response, commercialIssueAllowlist);
    if (failure) throw new ValidationApiError(failure);
    throw new Error(`Commercial settings API returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const createLegalEntity = (input: LegalEntityInput) => mutation<LegalEntitySummary>('/api/settings/legal-entities', 'POST', input);
export const updateLegalEntity = (id: string, input: LegalEntityInput) => mutation<LegalEntitySummary>(`/api/settings/legal-entities/${encodeURIComponent(id)}`, 'PATCH', input);
export const createBankAccount = (input: BankAccountInput) => mutation<BankAccountSummary>('/api/settings/bank-accounts', 'POST', input);
export const updateBankAccount = (id: string, input: BankAccountInput) => mutation<BankAccountSummary>(`/api/settings/bank-accounts/${encodeURIComponent(id)}`, 'PATCH', input);

export const deleteLegalEntity = (id: string) => remove(`/api/settings/legal-entities/${encodeURIComponent(id)}`);
export const deleteBankAccount = (id: string) => remove(`/api/settings/bank-accounts/${encodeURIComponent(id)}`);

async function remove(path: string): Promise<void> {
  const response = await mutatingFetch(path, { method: 'DELETE' });
  if (response.ok) return;
  let code: CommercialSettingsErrorCode | null = null;
  try {
    const body = await response.clone().json() as { code?: unknown };
    if (typeof body.code === 'string' && commercialErrorCodes.includes(body.code as CommercialSettingsErrorCode)) code = body.code as CommercialSettingsErrorCode;
  } catch {
    // Keep unexpected provider/server responses out of the user-visible error.
  }
  throw new CommercialSettingsApiError(response.status, code);
}

export async function getBankAccountDetail(id: string): Promise<BankAccountDetail> {
  const response = await fetch(`/api/settings/bank-accounts/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Commercial settings API returned HTTP ${response.status}`);
  return response.json() as Promise<BankAccountDetail>;
}
