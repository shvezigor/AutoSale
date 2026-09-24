'use client';

import type { OrderCommercialTermsSummary } from '../../../../packages/contracts/src/commercial';
import { useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { LoadingButton } from './loading-button';
import { FormField } from './form-field';
import { parseValidationFailure } from '../api/validation-errors';

export function OrderCommercialTermsCard({ orderId, initial, locked, onChange }: {
  orderId: string;
  initial: OrderCommercialTermsSummary | null;
  locked: boolean;
  onChange: (terms: OrderCommercialTermsSummary) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [terms, setTerms] = useState(initial);
  const [accountId, setAccountId] = useState(initial?.bankAccount?.id ?? '');
  const [pending, setPending] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => { setTerms(initial); setAccountId(initial?.bankAccount?.id ?? ''); }, [initial]);
  useEffect(() => { if (accountError && pending === null) document.getElementById('commercial-payment-account')?.focus(); }, [accountError, pending]);

  async function preview() {
    setPending('preview'); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${orderId}/commercial-terms/preview`, { method: 'POST' });
      if (!response.ok) throw new Error(t('orders.commercialLoadFailed'));
      const next = await response.json() as OrderCommercialTermsSummary;
      setTerms(next); setAccountId(next.bankAccount?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.commercialLoadFailed')); }
    finally { setPending(null); }
  }

  async function save() {
    if (!terms) return;
    if (accountId && accountId !== terms.bankAccount?.id && !terms.eligibleAccounts.some((account) => account.id === accountId)) {
      setAccountError(t('validation.invalid'));
      return;
    }
    setPending('save'); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${orderId}/commercial-terms`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: terms.version,
          legalEntityId: terms.legalEntity?.id ?? null,
          bankAccountId: accountId || null,
          initializeLegacy: terms.legacy,
        }),
      });
      if (response.status === 409) throw new Error(t('orders.commercialConflict'));
      if (!response.ok) {
        const failure = await parseValidationFailure(response, { version: ['INVALID_VERSION'], legalEntityId: ['INVALID_LEGAL_ENTITY'], bankAccountId: ['INVALID_BANK_ACCOUNT'], initializeLegacy: ['INVALID_LEGACY_FLAG'] });
        if (failure?.issues.some((issue) => issue.field === 'bankAccountId')) {
          setAccountError(t('validation.invalid'));
          return;
        }
        throw new Error(t('orders.commercialSaveFailed'));
      }
      const next = await response.json() as OrderCommercialTermsSummary;
      setTerms(next); setAccountId(next.bankAccount?.id ?? ''); await onChange(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.commercialSaveFailed')); }
    finally { setPending(null); }
  }

  return <section className="order-commercial-card review-section" aria-labelledby="commercial-heading" aria-busy={pending !== null}>
    <div className="commercial-card-heading"><div><h2 id="commercial-heading">{t('orders.commercialTitle')}</h2><p>{t('orders.commercialDescription')}</p></div>{terms?.pricingStatus === 'READY' && <span className="commercial-ready">{t('orders.commercialCalculated')}</span>}</div>
    {!terms ? <div className="commercial-empty"><p>{t('orders.commercialLegacy')}</p><LoadingButton pending={pending === 'preview'} pendingLabel={t('orders.commercialCalculating')} onClick={() => void preview()} type="button">{t('orders.commercialCalculate')}</LoadingButton></div> : <>
      <div className="commercial-amount"><span>{t('orders.expectedTotal')}</span><strong>{terms.totalAmount && terms.currency ? money(terms.totalAmount, terms.currency, locale) : '—'}</strong></div>
      <p className="commercial-payment-note">{t('orders.expectedNotReceived')}</p>
      {terms.issueCodes.length > 0 && <ul className="commercial-issues">{terms.issueCodes.map((issue) => <li key={issue}>{issueLabel(issue, t)}</li>)}</ul>}
      <dl className="commercial-selection-summary"><div><dt>{t('orders.sellerEntity')}</dt><dd>{terms.legalEntity?.displayName ?? t('orders.notSpecified')}</dd></div><div><dt>{t('orders.paymentCurrency')}</dt><dd>{terms.currency ?? '—'}</dd></div></dl>
      <FormField className="commercial-account-select" id="commercial-payment-account" label={t('orders.paymentAccount')} error={accountError}><select disabled={locked || pending !== null || !terms.legalEntity || !terms.currency} value={accountId} onChange={(event) => { setAccountId(event.target.value); setAccountError(null); }}><option value="">{t('orders.noPaymentAccount')}</option>{terms.eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.maskedIban} · {account.currency}</option>)}</select></FormField>
      {terms.eligibleAccounts.length === 0 && <p className="commercial-hint">{t('orders.noEligibleAccounts')}</p>}
      {locked ? <p className="commercial-lock">{t('orders.commercialLocked')}</p> : <div className="commercial-card-actions"><LoadingButton pending={pending === 'save'} pendingLabel={t('orders.saving')} disabled={pending !== null} onClick={() => void save()} type="button">{terms.legacy ? t('orders.saveCalculation') : t('orders.savePaymentDetails')}</LoadingButton></div>}
    </>}
    {error && <p className="commercial-card-error" role="alert">{error}</p>}
  </section>;
}

function money(value: string, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'uk-UA', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(value));
}

function issueLabel(issue: OrderCommercialTermsSummary['issueCodes'][number], t: ReturnType<typeof useI18n>['t']): string {
  return ({ ITEM_PRICE_MISSING: t('orders.itemPriceMissing'), ITEM_CURRENCY_MISSING: t('orders.itemCurrencyMissing'), MIXED_CURRENCIES: t('orders.mixedCurrencies') })[issue];
}
