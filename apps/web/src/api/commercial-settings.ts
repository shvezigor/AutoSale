import type {
  BankAccountDetail,
  BankAccountInput,
  BankAccountSummary,
  LegalEntityInput,
  LegalEntitySummary,
} from '../../../../packages/contracts/src/commercial';

import { mutatingFetch } from '../auth/csrf-fetch';

async function mutation<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await mutatingFetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Commercial settings API returned HTTP ${response.status}`);
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
