'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';

const statusLabels: Record<string, string> = { NEEDS_REVIEW: 'Потребує перевірки', APPROVED: 'Підтверджено', AUTO_APPROVED: 'Підтверджено автоматично', CANCELLED: 'Відхилено', AI_PROCESSING: 'AI обробляє', AI_FAILED: 'Помилка AI' };

export function OrderReviewPanel({ initialOrder }: { initialOrder: ManagerOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const [draft, setDraft] = useState(initialOrder);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sheetsExport, setSheetsExport] = useState(initialOrder.sheetsExport);
  const reviewIssues = validationHints(order.validationIssues, draft);
  const unresolved = reviewIssues.length > 0;
  const final = ['APPROVED', 'AUTO_APPROVED', 'CANCELLED'].includes(order.status);

  async function transition(action: 'approve' | 'cancel') {
    setPending(true); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій' }) });
      if (!response.ok) throw new Error('Не вдалося змінити статус замовлення');
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next); setSheetsExport(next.sheetsExport);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function save() {
    setPending(true); setError(null); setSaved(false);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій', customer: draft.customer, delivery: draft.delivery, items: draft.items.map(({ id, catalogId, quantity, color, size }) => ({ id, catalogId, quantity, color, size })) }) });
      if (!response.ok) throw new Error('Не вдалося зберегти зміни');
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function retrySheetsExport() {
    setPending(true); setError(null);
    try {
      const response = await mutatingFetch(`/api/orders/${order.id}/sheets-export/retry`, { method: 'POST' });
      if (!response.ok) throw new Error('Не вдалося повторити синхронізацію');
      setSheetsExport(await response.json() as NonNullable<ManagerOrder['sheetsExport']>);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  const changeItem = (id: string, values: Partial<ManagerOrder['items'][number]>) => setDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...values } : item) });

  return <section className="review-panel" aria-labelledby="order-heading">
    <header className="review-heading"><div><h1 id="order-heading">Замовлення</h1><span className={`order-status status-${order.status.toLowerCase()}`}>{statusLabels[order.status] ?? order.status}</span></div><strong>{Math.round((order.overallConfidence ?? 0) * 100)}%<small>впевненість</small></strong></header>
    {unresolved && <section className="validation-warning" aria-labelledby="validation-heading"><strong id="validation-heading">Перевірте дані перед підтвердженням</strong><ul>{reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section>}
    <div className="review-fields-grid">
      <EditableFields title="Клієнт" rows={[['Ім’я', draft.customer.name, (value) => setDraft({ ...draft, customer: { ...draft.customer, name: value } })], ['Телефон', draft.customer.phone, (value) => setDraft({ ...draft, customer: { ...draft.customer, phone: value } })]]} />
      <EditableFields title="Доставка" rows={[
        ['Місто', draft.delivery.city, (value) => setDraft({ ...draft, delivery: { ...draft.delivery, city: value } })],
        ['Відділення Нової пошти', draft.delivery.novaPoshtaBranch, (value) => setDraft({ ...draft, delivery: { ...draft.delivery, novaPoshtaBranch: value } })],
        ['Адреса доставки', draft.delivery.address, (value) => setDraft({ ...draft, delivery: { ...draft.delivery, address: value } })],
      ]} />
    </div>
    <section className="review-section"><h2>Товари</h2>{draft.items.map((item, index) => <article className="review-item" data-low-confidence={item.confidence < 0.9} key={item.id}><div className="review-item-head"><label><span className="sr-only">Товар {index + 1}</span><select value={item.catalogId ?? ''} onChange={(event) => changeItem(item.id, { catalogId: event.target.value || null, productName: draft.catalogueCandidates.find((candidate) => candidate.sku === event.target.value)?.name ?? null })}><option value="">Оберіть товар</option>{draft.catalogueCandidates.map((candidate) => <option key={candidate.sku} value={candidate.sku}>{candidate.sku} — {candidate.name}</option>)}</select></label><b>{Math.round(item.confidence * 100)}%</b></div><div className="item-edit-grid"><label>Розмір<input value={item.size ?? ''} onChange={(event) => changeItem(item.id, { size: event.target.value || null })} /></label><label>Колір<input value={item.color ?? ''} onChange={(event) => changeItem(item.id, { color: event.target.value || null })} /></label><label>Кількість<input min="1" type="number" value={item.quantity} onChange={(event) => changeItem(item.id, { quantity: Number(event.target.value) })} /></label></div></article>)}</section>
    {sheetsExport && <SheetsExportState value={sheetsExport} pending={pending} retry={() => void retrySheetsExport()} />}
    <div className="review-actions"><button className="secondary" disabled={pending || final} onClick={() => void save()} type="button">Зберегти зміни</button>{saved && <p className="save-success">Зміни збережено</p>}<button disabled={pending || unresolved || final} onClick={() => void transition('approve')} type="button">Підтвердити</button><button className="secondary" disabled={pending || final} onClick={() => void transition('cancel')} type="button">Відхилити</button>{error && <p role="alert">{error}</p>}</div>
  </section>;
}

function validationHints(issues: string[], draft: ManagerOrder): string[] {
  const hints = new Set<string>();
  if (!draft.customer.name) hints.add('Додайте ім’я клієнта');
  if (!draft.customer.phone) hints.add('Додайте номер телефону клієнта');
  if (!draft.delivery.city) hints.add('Додайте місто доставки');
  if (!draft.delivery.novaPoshtaBranch && !draft.delivery.address) {
    hints.add('Додайте адресу або відділення доставки');
  }
  if (draft.items.length === 0) hints.add('Додайте хоча б один товар');
  draft.items.forEach((item, index) => {
    if (!item.catalogId) hints.add(`Для товару ${index + 1} виберіть позицію з каталогу`);
    if (item.quantity < 1) hints.add(`Для товару ${index + 1} вкажіть кількість`);
  });
  if (issues.includes('isOrder')) {
    hints.add('Переписка ще не містить чіткого підтвердження замовлення');
  }
  return [...hints];
}

function SheetsExportState({ value, pending, retry }: { value: NonNullable<ManagerOrder['sheetsExport']>; pending: boolean; retry: () => void }) {
  const title = value.status === 'SUCCEEDED' ? 'Синхронізовано з Google Sheets' : value.status === 'FAILED' ? 'Помилка синхронізації' : value.status === 'PROCESSING' ? 'Синхронізація виконується' : 'Очікує синхронізації';
  return <section className={`sheets-export-state export-${value.status.toLowerCase()}`} aria-live="polite"><div><h2>{title}</h2>{value.rowNumber && <span>Рядок {value.rowNumber}</span>}{value.errorSummary && <p>{value.errorSummary}</p>}</div>{value.retryAllowed && <button className="secondary" disabled={pending} onClick={retry} type="button">Повторити синхронізацію</button>}</section>;
}

function EditableFields({ title, rows }: { title: string; rows: Array<[string, string | null, (value: string | null) => void]> }) {
  return <section className="review-section"><h2>{title}</h2><div className="editable-fields">{rows.map(([label, value, change]) => <label key={label}><span>{label}</span><input aria-label={label} value={value ?? ''} onChange={(event) => change(event.target.value || null)} /></label>)}</div></section>;
}
