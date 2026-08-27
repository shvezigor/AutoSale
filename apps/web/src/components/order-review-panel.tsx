'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import { useState } from 'react';

const statusLabels: Record<string, string> = { NEEDS_REVIEW: 'Потребує перевірки', APPROVED: 'Підтверджено', AUTO_APPROVED: 'Підтверджено автоматично', CANCELLED: 'Відхилено', AI_PROCESSING: 'AI обробляє', AI_FAILED: 'Помилка AI' };

export function OrderReviewPanel({ initialOrder }: { initialOrder: ManagerOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const [draft, setDraft] = useState(initialOrder);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const unresolved = order.validationIssues.length > 0 || draft.items.length === 0 || draft.items.some((item) => !item.catalogId || item.quantity < 1);
  const final = ['APPROVED', 'AUTO_APPROVED', 'CANCELLED'].includes(order.status);

  async function transition(action: 'approve' | 'cancel') {
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/orders/${order.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій' }) });
      if (!response.ok) throw new Error('Не вдалося змінити статус замовлення');
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function save() {
    setPending(true); setError(null); setSaved(false);
    try {
      const response = await fetch(`/api/orders/${order.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'Андрій', customer: draft.customer, delivery: draft.delivery, items: draft.items.map(({ id, catalogId, quantity, color, size }) => ({ id, catalogId, quantity, color, size })) }) });
      if (!response.ok) throw new Error('Не вдалося зберегти зміни');
      const next = await response.json() as ManagerOrder; setOrder(next); setDraft(next); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  const changeItem = (id: string, values: Partial<ManagerOrder['items'][number]>) => setDraft({ ...draft, items: draft.items.map((item) => item.id === id ? { ...item, ...values } : item) });

  return <section className="review-panel" aria-labelledby="order-heading">
    <header className="review-heading"><div><h1 id="order-heading">Замовлення</h1><span className={`order-status status-${order.status.toLowerCase()}`}>{statusLabels[order.status] ?? order.status}</span></div><strong>{Math.round((order.overallConfidence ?? 0) * 100)}%<small>впевненість</small></strong></header>
    {unresolved && <p className="validation-warning">Потрібно заповнити: {order.validationIssues.join(', ') || 'коректний товар'}</p>}
    <EditableFields title="Клієнт" rows={[['Ім’я', draft.customer.name, (value) => setDraft({ ...draft, customer: { ...draft.customer, name: value } })], ['Телефон', draft.customer.phone, (value) => setDraft({ ...draft, customer: { ...draft.customer, phone: value } })]]} />
    <EditableFields title="Доставка" rows={[['Місто', draft.delivery.city, (value) => setDraft({ ...draft, delivery: { ...draft.delivery, city: value } })], ['Відділення', draft.delivery.novaPoshtaBranch, (value) => setDraft({ ...draft, delivery: { ...draft.delivery, novaPoshtaBranch: value } })]]} />
    <section className="review-section"><h2>Товари</h2>{draft.items.map((item, index) => <article className="review-item" data-low-confidence={item.confidence < 0.9} key={item.id}><div className="review-item-head"><label><span className="sr-only">Товар {index + 1}</span><select value={item.catalogId ?? ''} onChange={(event) => changeItem(item.id, { catalogId: event.target.value || null, productName: draft.catalogueCandidates.find((candidate) => candidate.sku === event.target.value)?.name ?? null })}><option value="">Оберіть товар</option>{draft.catalogueCandidates.map((candidate) => <option key={candidate.sku} value={candidate.sku}>{candidate.sku} — {candidate.name}</option>)}</select></label><b>{Math.round(item.confidence * 100)}%</b></div><div className="item-edit-grid"><label>Розмір<input value={item.size ?? ''} onChange={(event) => changeItem(item.id, { size: event.target.value || null })} /></label><label>Колір<input value={item.color ?? ''} onChange={(event) => changeItem(item.id, { color: event.target.value || null })} /></label><label>Кількість<input min="1" type="number" value={item.quantity} onChange={(event) => changeItem(item.id, { quantity: Number(event.target.value) })} /></label></div></article>)}</section>
    <div className="review-actions"><button className="secondary" disabled={pending || final} onClick={() => void save()} type="button">Зберегти зміни</button>{saved && <p className="save-success">Зміни збережено</p>}<button disabled={pending || unresolved || final} onClick={() => void transition('approve')} type="button">Підтвердити</button><button className="secondary" disabled={pending || final} onClick={() => void transition('cancel')} type="button">Відхилити</button>{error && <p role="alert">{error}</p>}</div>
  </section>;
}

function EditableFields({ title, rows }: { title: string; rows: Array<[string, string | null, (value: string | null) => void]> }) {
  return <section className="review-section"><h2>{title}</h2><div className="editable-fields">{rows.map(([label, value, change]) => <label key={label}><span>{label}</span><input aria-label={label} value={value ?? ''} onChange={(event) => change(event.target.value || null)} /></label>)}</div></section>;
}
