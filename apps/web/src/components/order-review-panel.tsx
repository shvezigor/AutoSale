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

export function OrderReviewPanel({ initialOrder, backHref = '/orders' }: { initialOrder: ManagerOrder; backHref?: string }) {
  const { t, formatNumber } = useI18n();
  const [order, setOrder] = useState(initialOrder);
  const [draft, setDraft] = useState(initialOrder);
  const [pendingAction, setPendingAction] = useState<'save' | 'approve' | 'cancel' | 'sheets' | 'handoff' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sheetsExport, setSheetsExport] = useState(initialOrder.sheetsExport);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const reviewIssues = validationHints(order.validationIssues, draft, t, formatNumber);
  const unresolved = reviewIssues.length > 0;
  const final = ['APPROVED', 'AUTO_APPROVED', 'CANCELLED'].includes(order.status);
  const approved = order.status === 'APPROVED' || order.status === 'AUTO_APPROVED';
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
    setPendingAction('save'); setError(null); setSaved(false);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій', customer: draft.customer, delivery: draft.delivery, items: draft.items.map(({ id, catalogId, quantity, color, size }) => ({ id, catalogId, quantity, color, size })) }) });
      if (!response.ok) throw new Error(t('orders.saveFailed'));
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
  const changeItem = (id: string, values: Partial<ManagerOrder['items'][number]>) => changeDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...values } : item) });

  return <section className="review-panel" aria-labelledby="order-heading">
    <Link className="order-back-link" href={backHref}><span aria-hidden="true">←</span> {t('orders.backToTable')}</Link>
    <header className="review-heading"><div><h1 id="order-heading">{t('orders.orderTitle')}</h1><span className={`order-status status-${order.status.toLowerCase()}`}>{reviewStatusLabel(order.status, t)}</span></div><strong>{formatNumber(Math.round((order.overallConfidence ?? 0) * 100))}%<small>{t('orders.confidenceLabel')}</small></strong></header>
    {unresolved && <section className="validation-warning" aria-labelledby="validation-heading"><strong id="validation-heading">{t('orders.reviewWarning')}</strong><ul>{reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
    <div className="review-fields-grid">
      <EditableFields title={t('orders.customerSection')} rows={[[t('orders.nameField'), draft.customer.name, (value) => changeDraft({ ...draft, customer: { ...draft.customer, name: value } })], [t('orders.phoneField'), draft.customer.phone, (value) => changeDraft({ ...draft, customer: { ...draft.customer, phone: value } })]]} />
      <EditableFields title={t('orders.deliverySection')} rows={[
        [t('orders.cityField'), draft.delivery.city, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, city: value } })],
        [t('orders.novaPoshtaBranch'), draft.delivery.novaPoshtaBranch, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, novaPoshtaBranch: value } })],
        [t('orders.addressField'), draft.delivery.address, (value) => changeDraft({ ...draft, delivery: { ...draft.delivery, address: value } })],
      ]} />
    </div>
    <section className="review-section"><h2>{t('orders.productsSection')}</h2>{draft.items.map((item, index) => <article className="review-item" data-low-confidence={item.confidence < 0.9} key={item.id}><div className="review-item-head"><label><span className="sr-only">{t('orders.productField', { number: formatNumber(index + 1) })}</span><select value={item.catalogId ?? ''} onChange={(event) => changeItem(item.id, { catalogId: event.target.value || null, productName: draft.catalogueCandidates.find((candidate) => candidate.sku === event.target.value)?.name ?? null })}><option value="">{t('orders.selectProduct')}</option>{draft.catalogueCandidates.map((candidate) => <option key={candidate.sku} value={candidate.sku}>{candidate.sku} — {candidate.name}</option>)}</select></label><b>{formatNumber(Math.round(item.confidence * 100))}%</b></div><div className="item-edit-grid"><label>{t('orders.sizeField')}<input value={item.size ?? ''} onChange={(event) => changeItem(item.id, { size: event.target.value || null })} /></label><label>{t('orders.colorField')}<input value={item.color ?? ''} onChange={(event) => changeItem(item.id, { color: event.target.value || null })} /></label><label>{t('orders.quantityField')}<input min="1" type="number" value={item.quantity} onChange={(event) => changeItem(item.id, { quantity: Number(event.target.value) })} /></label></div>{approved && <ProcurementItemCard item={item} locked={order.procurementSummary === 'HANDED_OFF'} onOrderChange={applyOrder} orderId={order.id} />}</article>)}</section>
    {sheetsExport && <SheetsExportState value={sheetsExport} pending={pending} retry={() => void retrySheetsExport()} />}
    <ShipmentPanel order={order} />
    <div className="review-actions">
      {saved && <p className="save-success">{t('orders.changesSaved')}</p>}
      {error && <p role="alert">{error}</p>}
      {!final && <>
        <button className="secondary" disabled={pending} onClick={() => void transition('cancel')} type="button">{t('orders.reject')}</button>
        {hasChanges && <LoadingButton className="secondary" pending={pendingAction === 'save'} pendingLabel={t('orders.saving')} disabled={pending} onClick={() => void save()} type="button">{t('orders.saveChanges')}</LoadingButton>}
        <LoadingButton pending={pendingAction === 'approve'} pendingLabel={t('orders.approving')} disabled={pending || unresolved} onClick={() => void transition('approve')} type="button">{t('orders.approve')}</LoadingButton>
      </>}
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
  return <section className={`sheets-export-state export-${value.status.toLowerCase()}`} aria-live="polite"><div><h2>{title}</h2>{value.rowNumber && <span>{t('orders.sheetRow', { number: formatNumber(value.rowNumber) })}</span>}{value.errorSummary && <p>{value.errorSummary}</p>}</div>{value.retryAllowed && <button className="secondary" disabled={pending} onClick={retry} type="button">{t('orders.retrySync')}</button>}</section>;
}

function reviewStatusLabel(status: ManagerOrder['status'], t: Translator) {
  return ({ NEEDS_REVIEW: t('orders.needsReview'), APPROVED: t('orders.approved'), AUTO_APPROVED: t('orders.autoApprovedFull'), CANCELLED: t('orders.rejected'), AI_PROCESSING: t('orders.aiProcessing'), AI_FAILED: t('orders.aiFailed') } satisfies Record<ManagerOrder['status'], string>)[status];
}

function EditableFields({ title, rows }: { title: string; rows: Array<[string, string | null, (value: string | null) => void]> }) {
  return <section className="review-section"><h2>{title}</h2><div className="editable-fields">{rows.map(([label, value, change]) => <label key={label}><span>{label}</span><input aria-label={label} value={value ?? ''} onChange={(event) => change(event.target.value || null)} /></label>)}</div></section>;
}
