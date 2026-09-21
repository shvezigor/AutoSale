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

export async function getBankAccountDetail(id: string): Promise<BankAccountDetail> {
  const response = await fetch(`/api/settings/bank-accounts/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Commercial settings API returned HTTP ${response.status}`);
  return response.json() as Promise<BankAccountDetail>;
}
