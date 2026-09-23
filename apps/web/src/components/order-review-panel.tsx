'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import Link from 'next/link';
import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { LoadingButton } from './loading-button';
import { ProcurementItemCard } from './procurement-item-card';
import { SupplierDispatchDialog } from './supplier-dispatch-dialog';
import { ShipmentPanel } from './shipment-panel';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { OrderCommercialTermsCard } from './order-commercial-terms-card';
import { OrderPaymentsCard } from './order-payments-card';
import { FormField } from './form-field';
import { parseValidationFailure } from '../api/validation-errors';

export function OrderReviewPanel({ initialOrder, backHref = '/orders', role = 'MANAGER' }: { initialOrder: ManagerOrder; backHref?: string; role?: 'OWNER' | 'MANAGER' | null }) {
  const { t, formatNumber } = useI18n();
  const [order, setOrder] = useState(initialOrder);
  const [draft, setDraft] = useState(initialOrder);
  const [pendingAction, setPendingAction] = useState<'save' | 'approve' | 'cancel' | 'sheets' | 'handoff' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [sheetsExport, setSheetsExport] = useState(initialOrder.sheetsExport);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const reviewIssues = validationHints(order.validationIssues, draft, t, formatNumber);
  const unresolved = reviewIssues.length > 0;
  const final = ['APPROVED', 'AUTO_APPROVED', 'CANCELLED'].includes(order.status);
  const approved = order.status === 'APPROVED' || order.status === 'AUTO_APPROVED';
  const correctionAllowed = order.status !== 'CANCELLED' && !order.procurementHandedOffAt && !order.supplierDispatch && !order.shipment;
  const hasActivePayment = order.paymentSummary?.payments.some((payment) => payment.cancelledAt === null) ?? false;
  const pending = pendingAction !== null;
  const hasChanges = editableOrderSnapshot(order) !== editableOrderSnapshot(draft);

  async function transition(action: 'approve' | 'cancel') {
    setPendingAction(action); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій' }) });
      if (!response.ok) throw new Error(t('orders.statusChangeFailed'));
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next); setSheetsExport(next.sheetsExport);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.genericError')); }
    finally { setPendingAction(null); }
  }

  async function save() {
    const errors: Record<string, string> = {};
    if (draft.customer.name !== order.customer.name && !draft.customer.name?.trim()) errors['customer.name'] = t('validation.required');
    if (draft.customer.phone !== order.customer.phone && !draft.customer.phone?.trim()) errors['customer.phone'] = t('validation.required');
    if (draft.delivery.city !== order.delivery.city && !draft.delivery.city?.trim()) errors['delivery.city'] = t('validation.required');
    if (!draft.delivery.address?.trim() && !draft.delivery.novaPoshtaBranch?.trim() && (draft.delivery.address !== order.delivery.address || draft.delivery.novaPoshtaBranch !== order.delivery.novaPoshtaBranch)) errors['delivery.novaPoshtaBranch'] = t('validation.required');
    for (const item of draft.items) {
      const original = order.items.find((entry) => entry.id === item.id);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) errors[`items.${item.id}.quantity`] = t('validation.minimum', { value: 1 });
      if (!item.catalogId && original?.catalogId !== item.catalogId) errors[`items.${item.id}.catalogId`] = t('orders.selectCatalogueProduct', { number: formatNumber(draft.items.indexOf(item) + 1) });
    }
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) {
      const [group, itemId, field] = first.split('.');
      document.getElementById(group === 'items' ? `order-item-${itemId}-${field}` : `order-${first.replaceAll('.', '-')}`)?.focus();
      return;
    }
    setPendingAction('save'); setError(null); setSaved(false);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій', customer: draft.customer, delivery: draft.delivery, ...(!hasActivePayment ? { items: draft.items.map(({ id, catalogId, quantity, color, size }) => ({ id, catalogId, quantity, color, size })) } : {}) }) });
      if (!response.ok) {
        const failure = await parseValidationFailure(response, { 'customer.name': ['INVALID_CUSTOMER_NAME'], 'customer.phone': ['INVALID_CUSTOMER_PHONE'], 'delivery.city': ['INVALID_DELIVERY_CITY'], 'delivery.address': ['INVALID_DELIVERY_ADDRESS'], 'delivery.novaPoshtaBranch': ['INVALID_DELIVERY_BRANCH'] });
        if (failure) {
          const mapped: Record<string, string> = {};
          for (const issue of failure.issues) mapped[issue.field] = t('validation.invalid');
          setFieldErrors(mapped);
          if (failure.issues[0]) document.getElementById(`order-${failure.issues[0].field.replaceAll('.', '-')}`)?.focus();
          return;
        }
        throw new Error(t('orders.saveFailed'));
      }
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.genericError')); }
    finally { setPendingAction(null); }
  }

  async function retrySheetsExport() {
    setPendingAction('sheets'); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}/sheets-export/retry`, { method: 'POST' });
      if (!response.ok) throw new Error(t('orders.syncRetryFailed'));
      setSheetsExport(await response.json() as NonNullable<ManagerOrder['sheetsExport']>);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.genericError')); }
    finally { setPendingAction(null); }
  }

  async function handOff() {
    setPendingAction('handoff'); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}/hand-off`, { method: 'POST' });
      if (!response.ok) throw new Error(t('orders.notReadyForHandoff'));
      applyOrder(await response.json() as ManagerOrder);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('orders.handoffFailed')); }
    finally { setPendingAction(null); }
  }

  function applyOrder(next: ManagerOrder) {
    setOrder(next); setDraft(next); setSheetsExport(next.sheetsExport);
  }

  function dispatched(result: { deliveryId: string; status: string }) {
    const next: ManagerOrder = {
      ...order,
      procurementSummary: 'SENDING',
      supplierDispatch: {
        deliveryId: result.deliveryId,
        status: result.status as NonNullable<ManagerOrder['supplierDispatch']>['status'],
        itemCount: order.items.filter((item) => item.procurementStatus === 'TO_ORDER').length,
      },
      items: order.items.map((item) => item.procurementStatus === 'TO_ORDER'
        ? { ...item, procurementStatus: 'SENDING' as const }
        : item),
    };
    applyOrder(next);
  }

  const changeDraft = (next: ManagerOrder) => { setDraft(next); setSaved(false); };
  const clearOrderField = (field: string) => setFieldErrors((current) => { const next = { ...current }; delete next[field]; return next; });
  const changeItem = (id: string, values: Partial<ManagerOrder['items'][number]>) => {
    setFieldErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(values)) delete next[`items.${id}.${field}`];
      return next;
    });
    changeDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...values } : item) });
  };

  return <section className="review-panel" aria-labelledby="order-heading">
    <Link className="order-back-link" href={backHref}><span aria-hidden="true">←</span> {t('orders.backToTable')}</Link>
    <header className="review-heading"><div><h1 id="order-heading">{t('orders.orderTitle')} {order.publicNumber}</h1><span className={`order-status status-${order.status.toLowerCase()}`}>{reviewStatusLabel(order.status, t)}</span></div><strong>{formatNumber(Math.round((order.overallConfidence ?? 0) * 100))}%<small>{t('orders.confidenceLabel')}</small></strong></header>
    {order.intentDetection && <p className="order-intent-notice" role="status">{intentDetectionExplanation(order.intentDetection.reason, t)}</p>}
    {unresolved && <section className="validation-warning" aria-labelledby="validation-heading"><strong id="validation-heading">{t('orders.reviewWarning')}</strong><ul>{reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
    <div className="review-fields-grid">
      <EditableFields disabled={!correctionAllowed} title={t('orders.customerSection')} errors={fieldErrors} clearError={clearOrderField} rows={[["customer.name", t('orders.nameField'), draft.customer.name, (value) => changeDraft({ ...draft, customer: { ...draft.customer, name: value } })], ["customer.phone", t('orders.phoneField'), draft.customer.phone, (value) => changeDraft({ ...draft, customer: { ...draft.customer, phone: value } })]]} />
      <EditableFields disabled={!correctionAllowed} title={t('orders.deliverySection')} errors={fieldErrors} clearError={clearOrderField} rows={[
        ['delivery.city', t('orders.cityField'), draft.delivery.city, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, city: value } })],
        ['delivery.novaPoshtaBranch', t('orders.novaPoshtaBranch'), draft.delivery.novaPoshtaBranch, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, novaPoshtaBranch: value } })],
        ['delivery.address', t('orders.addressField'), draft.delivery.address, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, address: value } })],
      ]} />
    </div>
    <section className="review-section"><h2>{t('orders.productsSection')}</h2>{hasActivePayment && <p className="payment-lock-notice">{t('orders.paymentLocksItems')}</p>}{draft.items.map((item, index) => <article className="review-item" data-low-confidence={item.confidence < 0.9} key={item.id}><div className="review-item-head"><FormField id={`order-item-${item.id}-catalogId`} label={<span className="sr-only">{t('orders.productField', { number: formatNumber(index + 1) })}</span>} error={fieldErrors[`items.${item.id}.catalogId`]}><select disabled={!correctionAllowed || hasActivePayment} value={item.catalogId ?? ''} onChange={(event) => changeItem(item.id, { catalogId: event.target.value || null, productName: draft.catalogueCandidates.find((candidate) => candidate.sku === event.target.value)?.name ?? null })}><option value="">{t('orders.selectProduct')}</option>{draft.catalogueCandidates.map((candidate) => <option key={candidate.sku} value={candidate.sku}>{candidate.sku} — {candidate.name}</option>)}</select></FormField><b>{formatNumber(Math.round(item.confidence * 100))}%</b></div><div className="item-edit-grid"><label>{t('orders.sizeField')}<input disabled={!correctionAllowed || hasActivePayment} value={item.size ?? ''} onChange={(event) => changeItem(item.id, { size: event.target.value || null })} /></label><label>{t('orders.colorField')}<input disabled={!correctionAllowed || hasActivePayment} value={item.color ?? ''} onChange={(event) => changeItem(item.id, { color: event.target.value || null })} /></label><FormField id={`order-item-${item.id}-quantity`} label={t('orders.quantityField')} error={fieldErrors[`items.${item.id}.quantity`]}><input disabled={!correctionAllowed || hasActivePayment} min="1" step="1" type="number" value={item.quantity} onChange={(event) => changeItem(item.id, { quantity: Number(event.target.value) })} /></FormField></div>{approved && <ProcurementItemCard item={item} locked={order.procurementSummary === 'HANDED_OFF'} onOrderChange={applyOrder} orderId={order.id} />}</article>)}</section>
    <OrderCommercialTermsCard orderId={order.id} initial={order.commercialTerms} locked={!correctionAllowed || hasActivePayment} onChange={(commercialTerms) => applyOrder({ ...order, commercialTerms })} />
    <OrderPaymentsCard orderId={order.id} initial={order.paymentSummary} accounts={order.commercialTerms?.eligibleAccounts ?? []} role={role} onChange={(paymentSummary) => applyOrder({ ...order, paymentSummary })} />
    {sheetsExport && <SheetsExportState value={sheetsExport} pending={pending} retry={() => void retrySheetsExport()} />}
    <ShipmentPanel order={order} />
    <div className="review-actions">
      {saved && <p className="save-success">{t('orders.changesSaved')}</p>}
      {error && <p role="alert">{error}</p>}
      {!final && <button className="secondary-button" disabled={pending} onClick={() => void transition('cancel')} type="button">{t('orders.reject')}</button>}
      {correctionAllowed && hasChanges && <LoadingButton className="secondary-button" pending={pendingAction === 'save'} pendingLabel={t('orders.saving')} disabled={pending} onClick={() => void save()} type="button">{t('orders.saveChanges')}</LoadingButton>}
      {!final && <LoadingButton pending={pendingAction === 'approve'} pendingLabel={t('orders.approving')} disabled={pending || unresolved} onClick={() => void transition('approve')} type="button">{t('orders.approve')}</LoadingButton>}
      {approved && order.items.some((item) => item.procurementStatus === 'TO_ORDER') && <button disabled={pending} onClick={() => setDispatchOpen(true)} type="button">{t('orders.sendSupplier')}</button>}
      {approved && order.procurementSummary === 'READY' && <LoadingButton pending={pendingAction === 'handoff'} pendingLabel={t('orders.handingOff')} disabled={pending} onClick={() => void handOff()} type="button">{t('orders.handOff')}</LoadingButton>}
    </div>
    {dispatchOpen && <SupplierDispatchDialog onClose={() => setDispatchOpen(false)} onDispatched={dispatched} open orderId={order.id} />}
  </section>;
}

function editableOrderSnapshot(order: ManagerOrder): string {
  return JSON.stringify({
    customer: order.customer,
    delivery: order.delivery,
    items: order.items.map(({ id, catalogId, quantity, color, size }) => ({
      id,
      catalogId,
      quantity,
      color,
      size,
    })),
  });
}

function validationHints(issues: string[], draft: ManagerOrder, t: Translator, formatNumber: (value: number) => string): string[] {
  const hints = new Set<string>();
  if (!draft.customer.name) hints.add(t('orders.addCustomerName'));
  if (!draft.customer.phone) hints.add(t('orders.addCustomerPhone'));
  if (!draft.delivery.city) hints.add(t('orders.addDeliveryCity'));
  if (!draft.delivery.novaPoshtaBranch && !draft.delivery.address) {
    hints.add(t('orders.addDeliveryAddress'));
  }
  if (draft.items.length === 0) hints.add(t('orders.addProduct'));
  draft.items.forEach((item, index) => {
    if (!item.catalogId) hints.add(t('orders.selectCatalogueProduct', { number: formatNumber(index + 1) }));
    if (item.quantity < 1) hints.add(t('orders.addQuantity', { number: formatNumber(index + 1) }));
  });
  if (issues.includes('isOrder')) {
    hints.add(t('orders.orderNotConfirmed'));
  }
  return [...hints];
}

function SheetsExportState({ value, pending, retry }: { value: NonNullable<ManagerOrder['sheetsExport']>; pending: boolean; retry: () => void }) {
  const { t, formatNumber } = useI18n();
  const title = value.status === 'SUCCEEDED' ? t('orders.sheetsSucceeded') : value.status === 'FAILED' ? t('orders.sheetsFailed') : value.status === 'PROCESSING' ? t('orders.sheetsProcessing') : t('orders.sheetsPending');
  return <section className={`sheets-export-state export-${value.status.toLowerCase()}`} aria-live="polite"><div><h2>{title}</h2>{value.rowNumber && <span>{t('orders.sheetRow', { number: formatNumber(value.rowNumber) })}</span>}{value.errorSummary && <p>{t('orders.syncErrorHint')}</p>}</div>{value.retryAllowed && <button className="secondary-button" disabled={pending} onClick={retry} type="button">{t('orders.retrySync')}</button>}</section>;
}

function reviewStatusLabel(status: ManagerOrder['status'], t: Translator) {
  return ({ NEEDS_REVIEW: t('orders.needsReview'), APPROVED: t('orders.approved'), AUTO_APPROVED: t('orders.autoApprovedFull'), CANCELLED: t('orders.rejected'), AI_PROCESSING: t('orders.aiProcessing'), AI_FAILED: t('orders.aiFailed') } satisfies Record<ManagerOrder['status'], string>)[status];
}

function intentDetectionExplanation(reason: NonNullable<ManagerOrder['intentDetection']>['reason'], t: Translator): string {
  return ({
    MANAGER_REVIEW_MODE: t('orders.intentManagerReview'),
    INCOMPLETE_ORDER: t('orders.intentIncomplete'),
    LOW_CONFIDENCE: t('orders.intentLowConfidence'),
    COMPLETE_HIGH_CONFIDENCE: t('orders.intentAutoCreated'),
  } satisfies Record<NonNullable<ManagerOrder['intentDetection']>['reason'], string>)[reason];
}

function EditableFields({ title, rows, errors, clearError, disabled = false }: { title: string; rows: Array<[string, string, string | null, (value: string | null) => void]>; errors: Record<string, string>; clearError: (field: string) => void; disabled?: boolean }) {
  return <section className="review-section"><h2>{title}</h2><div className="editable-fields">{rows.map(([field, label, value, change]) => <FormField key={field} id={`order-${field.replaceAll('.', '-')}`} label={label} error={errors[field]}><input aria-label={label} disabled={disabled} value={value ?? ''} onChange={(event) => { clearError(field); change(event.target.value || null); }} /></FormField>)}</div></section>;
}
