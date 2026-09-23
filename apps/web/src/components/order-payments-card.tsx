'use client';

import type { BankAccountSummary } from '../../../../packages/contracts/src/commercial';
import type { CashOnDeliveryCarrier, OrderPaymentRecord, OrderPaymentSummary, PaymentMethod } from '../../../../packages/contracts/src/payments';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { LoadingButton } from './loading-button';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, nativeConstraintMessage, type FieldErrors } from './form-validation';
import { parseValidationFailure } from '../api/validation-errors';

type MembershipRole = 'OWNER' | 'MANAGER' | null;

export function OrderPaymentsCard({ orderId, initial, accounts, role, onChange }: {
  orderId: string;
  initial: OrderPaymentSummary | null;
  accounts: BankAccountSummary[];
  role: MembershipRole;
  onChange: (summary: OrderPaymentSummary) => void;
}) {
  const { t, locale, formatDate } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [amount, setAmount] = useState(defaultAmount(initial));
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [receivedAt, setReceivedAt] = useState(localDateTime());
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? '');
  const [carrier, setCarrier] = useState<CashOnDeliveryCarrier>('NOVA_POSHTA');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'amount' | 'receivedAt' | 'bankAccountId' | 'carrier'>>({});
  const [cancelPaymentId, setCancelPaymentId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState('');

  useEffect(() => { setSummary(initial); }, [initial]);
  useEffect(() => {
    if (!amount && initial && Number(initial.remainingAmount) > 0) setAmount(initial.remainingAmount);
  }, [amount, initial]);

  const activePayments = useMemo(() => summary?.payments.filter((payment) => !payment.cancelledAt) ?? [], [summary]);

  function apply(next: OrderPaymentSummary) {
    setSummary(next);
    setAmount(defaultAmount(next));
    onChange(next);
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields: Array<'amount' | 'receivedAt' | 'bankAccountId' | 'carrier'> = ['amount', 'receivedAt'];
    if (method === 'BANK_TRANSFER') fields.push('bankAccountId');
    if (method === 'CASH_ON_DELIVERY') fields.push('carrier');
    const errors: FieldErrors<'amount' | 'receivedAt' | 'bankAccountId' | 'carrier'> = {};
    for (const field of fields) {
      const control = form.elements.namedItem(field);
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        const message = nativeConstraintMessage(control, t);
        if (message) errors[field] = message;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(form, fields.filter((field) => field in errors));
      return;
    }
    setPending('record'); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${orderId}/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount).toFixed(2), method, receivedAt: new Date(receivedAt).toISOString(),
          bankAccountId: method === 'BANK_TRANSFER' ? bankAccountId : null,
          carrier: method === 'CASH_ON_DELIVERY' ? carrier : null,
          note: note.trim() || null, idempotencyKey,
        }),
      });
      if (!response.ok) {
        const failure = await parseValidationFailure(response, { amount: ['INVALID_AMOUNT'], receivedAt: ['INVALID_RECEIVED_AT'], method: ['INVALID_METHOD'], bankAccountId: ['INVALID_BANK_ACCOUNT'], carrier: ['INVALID_CARRIER'], note: ['INVALID_NOTE'], idempotencyKey: ['INVALID_IDEMPOTENCY_KEY'] });
        if (failure) {
          const mapped: FieldErrors<'amount' | 'receivedAt' | 'bankAccountId' | 'carrier'> = {};
          for (const issue of failure.issues) {
            if (issue.field === 'amount') mapped.amount = t('validation.minimum', { value: '0.01' });
            if (issue.field === 'receivedAt') mapped.receivedAt = t('validation.invalid');
            if (issue.field === 'bankAccountId') mapped.bankAccountId = t('validation.invalid');
            if (issue.field === 'carrier') mapped.carrier = t('validation.invalid');
          }
          if (Object.keys(mapped).length) {
            setFieldErrors(mapped);
            focusFirstInvalid(form, fields.filter((field) => field in mapped));
            return;
          }
        }
        throw new Error(await paymentError(response, t('orders.paymentSaveFailed')));
      }
      const next = await response.json() as OrderPaymentSummary;
      apply(next); setNote(''); setIdempotencyKey(crypto.randomUUID());
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.paymentSaveFailed')); }
    finally { setPending(null); }
  }

  async function cancelPayment(event: FormEvent<HTMLFormElement>, payment: OrderPaymentRecord) {
    event.preventDefault();
    const form = event.currentTarget;
    const control = form.elements.namedItem('cancellationReason');
    const validationMessage = control instanceof HTMLTextAreaElement ? nativeConstraintMessage(control, t) : t('validation.invalid');
    setCancelReasonError(validationMessage ?? '');
    if (validationMessage) {
      focusFirstInvalid(form, ['cancellationReason']);
      return;
    }
    setPending(`cancel:${payment.id}`); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${orderId}/payments/${payment.id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim(), idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) {
        const failure = await parseValidationFailure(response, { reason: ['INVALID_REASON'], idempotencyKey: ['INVALID_IDEMPOTENCY_KEY'] });
        if (failure?.issues.some((issue) => issue.field === 'reason')) {
          setCancelReasonError(t('validation.tooShort', { count: 3 }));
          focusFirstInvalid(form, ['cancellationReason']);
          return;
        }
        throw new Error(await paymentError(response, t('orders.paymentCancelFailed')));
      }
      const next = await response.json() as OrderPaymentSummary;
      apply(next); setCancelPaymentId(null); setCancelReason('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.paymentCancelFailed')); }
    finally { setPending(null); }
  }

  return <section className="order-payments-card review-section" aria-labelledby="payments-heading" aria-busy={pending !== null}>
    <div className="payment-card-heading"><div><h2 id="payments-heading">{t('orders.paymentsTitle')}</h2><p>{t('orders.paymentsDescription')}</p></div>{summary && <span className={`payment-status payment-${summary.status.toLowerCase()}`}>{paymentStatus(summary.status, t)}</span>}</div>
    {!summary ? <p className="payment-unavailable">{t('orders.paymentUnavailable')}</p> : <>
      <dl className="payment-summary">
        <SummaryValue label={t('orders.paymentExpected')} value={money(summary.expectedAmount, summary.currency, locale)} />
        <SummaryValue label={t('orders.paymentReceived')} value={money(summary.paidAmount, summary.currency, locale)} />
        <SummaryValue label={t('orders.paymentRemaining')} value={money(summary.remainingAmount, summary.currency, locale)} />
        <SummaryValue label={t('orders.paymentStatus')} value={paymentStatus(summary.status, t)} />
      </dl>
      <form className="payment-form" noValidate aria-label={t('orders.addPayment')} onSubmit={(event) => void recordPayment(event)}>
        <div className="payment-form-grid">
          <FormField id="payment-amount" label={t('orders.paymentAmount')} error={fieldErrors.amount} required><input name="amount" type="number" min="0.01" required step="0.01" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setFieldErrors((current) => clearFieldError(current, 'amount')); }} /></FormField>
          <label>{t('orders.paymentMethod')}<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{(['BANK_TRANSFER', 'CASH', 'CASH_ON_DELIVERY', 'OTHER'] as const).map((value) => <option key={value} value={value}>{methodLabel(value, t)}</option>)}</select></label>
          <FormField id="payment-received-at" label={t('orders.paymentDate')} error={fieldErrors.receivedAt} required><input name="receivedAt" required max={localDateTime()} type="datetime-local" value={receivedAt} onChange={(event) => { setReceivedAt(event.target.value); setFieldErrors((current) => clearFieldError(current, 'receivedAt')); }} /></FormField>
          {method === 'BANK_TRANSFER' && <FormField id="payment-account" label={t('orders.paymentAccount')} error={fieldErrors.bankAccountId} required><select name="bankAccountId" required value={bankAccountId} onChange={(event) => { setBankAccountId(event.target.value); setFieldErrors((current) => clearFieldError(current, 'bankAccountId')); }}><option value="">{t('orders.selectPaymentAccount')}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {account.maskedIban}</option>)}</select></FormField>}
          {method === 'CASH_ON_DELIVERY' && <FormField id="payment-carrier" label={t('orders.paymentCarrier')} error={fieldErrors.carrier} required><select name="carrier" required value={carrier} onChange={(event) => { setCarrier(event.target.value as CashOnDeliveryCarrier); setFieldErrors((current) => clearFieldError(current, 'carrier')); }}>{(['NOVA_POSHTA', 'MEEST', 'UKRPOSHTA'] as const).map((value) => <option key={value} value={value}>{carrierLabel(value, t)}</option>)}</select></FormField>}
          <label className="payment-note">{t('orders.paymentNote')}<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="payment-form-actions"><LoadingButton pending={pending === 'record'} pendingLabel={t('orders.paymentSaving')} disabled={pending !== null} type="submit">{t('orders.recordPayment')}</LoadingButton></div>
      </form>
      <section className="payment-history" aria-labelledby="payment-history-heading"><h3 id="payment-history-heading">{t('orders.paymentHistory')}</h3>{summary.payments.length === 0 ? <p>{t('orders.noPayments')}</p> : <ul>{summary.payments.map((payment) => <li className="payment-history-row" data-cancelled={Boolean(payment.cancelledAt)} key={payment.id}>
        <div><strong>{money(payment.amount, payment.currency, locale)}</strong><span>{methodLabel(payment.method, t)} · {formatDate(payment.receivedAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>{payment.note && <small>{payment.note}</small>}{payment.cancelledAt && <small>{t('orders.paymentCancelled')}: {payment.cancellationReason}</small>}</div>
        <span>{payment.createdBy.name}</span>
        {role === 'OWNER' && !payment.cancelledAt && (cancelPaymentId === payment.id ? <form className="payment-cancel-form" noValidate aria-label={t('orders.cancelPayment')} onSubmit={(event) => void cancelPayment(event, payment)}><FormField id="payment-cancellation-reason" label={t('orders.cancellationReason')} error={cancelReasonError} required><textarea name="cancellationReason" required minLength={3} maxLength={500} value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); setCancelReasonError(''); }} /></FormField><div><button className="secondary-button" disabled={pending !== null} onClick={() => { setCancelPaymentId(null); setCancelReason(''); setCancelReasonError(''); }} type="button">{t('orders.cancel')}</button><LoadingButton pending={pending === `cancel:${payment.id}`} pendingLabel={t('orders.paymentCancelling')} disabled={pending !== null} type="submit">{t('orders.confirmCancellation')}</LoadingButton></div></form> : <button className="text-button" disabled={pending !== null} onClick={() => setCancelPaymentId(payment.id)} type="button">{t('orders.cancelPayment')}</button>)}
      </li>)}</ul>}</section>
      {activePayments.length > 0 && <p className="payment-lock-notice" role="status">{t('orders.paymentLocksOrder')}</p>}
    </>}
    {error && <p className="commercial-card-error" role="alert">{error}</p>}
  </section>;
}

function SummaryValue({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function defaultAmount(summary: OrderPaymentSummary | null): string { return summary && Number(summary.remainingAmount) > 0 ? summary.remainingAmount : ''; }
function localDateTime(): string { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function money(value: string, currency: string, locale: string): string { return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'uk-UA', { style: 'currency', currency }).format(Number(value)); }
function paymentStatus(status: OrderPaymentSummary['status'], t: ReturnType<typeof useI18n>['t']): string { return ({ UNPAID: t('orders.paymentUnpaid'), PARTIALLY_PAID: t('orders.paymentPartial'), PAID: t('orders.paymentPaid'), OVERPAID: t('orders.paymentOverpaid') })[status]; }
function methodLabel(method: PaymentMethod, t: ReturnType<typeof useI18n>['t']): string { return ({ BANK_TRANSFER: t('orders.methodBankTransfer'), CASH: t('orders.methodCash'), CASH_ON_DELIVERY: t('orders.methodCashOnDelivery'), OTHER: t('orders.methodOther') })[method]; }
function carrierLabel(carrier: CashOnDeliveryCarrier, t: ReturnType<typeof useI18n>['t']): string { return ({ NOVA_POSHTA: t('orders.novaPoshta'), MEEST: 'Meest', UKRPOSHTA: t('orders.ukrposhta') })[carrier]; }
async function paymentError(response: Response, fallback: string): Promise<string> { try { const body = await response.json() as { message?: unknown }; return typeof body.message === 'string' ? body.message : fallback; } catch { return fallback; } }
