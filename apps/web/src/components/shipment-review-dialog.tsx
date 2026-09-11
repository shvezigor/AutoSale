'use client';

import type { DeliveryLocation, ShipmentDraftInput, ShipmentDraftPrefill, ShipmentOverview, ShipmentQuote, ShipmentSummary } from '../../../../packages/contracts/src/delivery';
import { useEffect, useMemo, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

type FormDraft = Omit<ShipmentDraftInput, 'recipient' | 'destination'> & {
  recipient: { name: string | null; phone: string | null };
  destination: ShipmentDraftInput['destination'] | null;
};

export function ShipmentReviewDialog({ orderId, onClose, onSaved }: {
  orderId: string;
  onClose(): void;
  onSaved(shipment: ShipmentSummary): void;
}) {
  const [overview, setOverview] = useState<ShipmentOverview | null>(null);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [city, setCity] = useState<DeliveryLocation | null>(null);
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [destinationType, setDestinationType] = useState<'BRANCH' | 'PARCEL_LOCKER'>('BRANCH');
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'creating' | 'error'>('loading');
  const closeButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${orderId}/shipments`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('load');
        return await response.json() as ShipmentOverview;
      })
      .then((value) => {
        if (!active) return;
        setOverview(value);
        setDraft(value.draft ? formDraft(value.draft) : null);
        if (value.draft && 'destination' in value.draft) {
          const destination = value.draft.destination;
          setCity({ ref: destination.cityRef, provider: 'NOVA_POSHTA', type: 'CITY', label: destination.cityRef });
          if (destination.type !== 'ADDRESS') {
            setDestinationType(destination.type);
            setLocation({ ref: destination.locationRef, provider: 'NOVA_POSHTA', type: destination.type, label: destination.label, cityRef: destination.cityRef });
          }
        }
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [orderId]);

  const completeDraft = useMemo(() => {
    if (!draft || !city || !location || !draft.recipient.name || !draft.recipient.phone) return null;
    return {
      ...draft,
      recipient: { name: draft.recipient.name, phone: draft.recipient.phone },
      destination: { type: location.type as 'BRANCH' | 'PARCEL_LOCKER', cityRef: city.ref, locationRef: location.ref, label: location.label },
    } satisfies ShipmentDraftInput;
  }, [city, draft, location]);

  useEffect(() => {
    setQuote(null);
    if (!completeDraft) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void mutatingFetch(`/api/orders/${orderId}/shipments/quote`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(completeDraft), signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error('quote');
        return await response.json() as ShipmentQuote;
      }).then(setQuote).catch(() => { if (!controller.signal.aborted) setQuote(null); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [completeDraft, orderId]);

  async function save() {
    if (!completeDraft) return;
    setState('saving');
    try {
      const response = await mutatingFetch(`/api/orders/${orderId}/shipments/draft`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(completeDraft),
      });
      if (!response.ok) throw new Error('save');
      const shipment = await response.json() as ShipmentSummary;
      onSaved(shipment);
      toast.show({ type: 'success', title: 'Чернетку доставки збережено' });
      onClose();
    } catch {
      setState('ready');
      toast.show({ type: 'error', title: 'Не вдалося зберегти доставку' });
    }
  }

  async function create() {
    if (!completeDraft || state === 'creating') return;
    setState('creating');
    try {
      const draftResponse = await mutatingFetch(`/api/orders/${orderId}/shipments/draft`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(completeDraft),
      });
      if (!draftResponse.ok) throw new Error('save');
      const response = await mutatingFetch(`/api/orders/${orderId}/shipments`, { method: 'POST' });
      if (!response.ok) throw new Error('create');
      const shipment = await response.json() as ShipmentSummary;
      onSaved(shipment);
      toast.show({ type: 'success', title: 'Створення ТТН розпочато' });
      onClose();
    } catch {
      setState('ready');
      toast.show({ type: 'error', title: 'Не вдалося розпочати створення ТТН' });
    }
  }

  return <div className="modal-backdrop shipment-dialog-backdrop" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="shipment-dialog-title" className="shipment-review-dialog">
      <header><div><span>Нова Пошта</span><h2 id="shipment-dialog-title">Оформлення доставки</h2></div><button ref={closeButton} className="icon-button" type="button" aria-label="Закрити" onClick={onClose}>×</button></header>
      {state === 'loading' && <div className="dialog-loading"><span className="button-spinner" aria-hidden="true" /> Завантажуємо дані доставки…</div>}
      {state === 'error' && <p className="dialog-error" role="alert">Не вдалося завантажити налаштування доставки.</p>}
      {overview && !overview.canCreateShipment && <p className="dialog-error">{blockedReasonLabel(overview.blockedReason)}</p>}
      {draft && overview?.canCreateShipment && <div className="shipment-form">
        <div className="shipment-form-grid">
          <Field label="Ім’я отримувача" value={draft.recipient.name ?? ''} onChange={(value) => setDraft({ ...draft, recipient: { ...draft.recipient, name: value } })} />
          <Field label="Телефон отримувача" value={draft.recipient.phone ?? ''} onChange={(value) => setDraft({ ...draft, recipient: { ...draft.recipient, phone: value } })} />
          <DeliveryLocationPicker label="Місто" type="CITY" initialQuery={'cityHint' in overview.draft! ? overview.draft.cityHint ?? '' : ''} value={city} onSelect={(value) => { setCity(value); setLocation(null); }} />
          <label><span>Тип отримання</span><select aria-label="Тип отримання" value={destinationType} onChange={(event) => { setDestinationType(event.target.value as 'BRANCH' | 'PARCEL_LOCKER'); setLocation(null); }}><option value="BRANCH">Відділення</option><option value="PARCEL_LOCKER">Поштомат</option></select></label>
          <DeliveryLocationPicker label="Відділення або поштомат" type={destinationType} {...(city ? { cityRef: city.ref } : {})} initialQuery={'locationHint' in overview.draft! ? overview.draft.locationHint ?? '' : ''} value={location} onSelect={setLocation} />
        </div>
        <div className="shipment-parcel-grid">
          <NumberField label="Вага, кг" value={draft.parcels[0]!.weightKg} onChange={(value) => setDraft(withParcel(draft, 'weightKg', value))} />
          <NumberField label="Довжина, см" value={draft.parcels[0]!.lengthCm} onChange={(value) => setDraft(withParcel(draft, 'lengthCm', value))} />
          <NumberField label="Ширина, см" value={draft.parcels[0]!.widthCm} onChange={(value) => setDraft(withParcel(draft, 'widthCm', value))} />
          <NumberField label="Висота, см" value={draft.parcels[0]!.heightCm} onChange={(value) => setDraft(withParcel(draft, 'heightCm', value))} />
          <NumberField label="Оголошена вартість, грн" value={draft.declaredValue} onChange={(value) => setDraft({ ...draft, declaredValue: value })} />
          <NumberField label="Післяплата, грн" value={draft.codAmount ?? 0} onChange={(value) => setDraft({ ...draft, codAmount: value > 0 ? value : null })} />
        </div>
        {draft.codAmount !== null && draft.codAmount > draft.declaredValue && <p className="shipment-validation" role="alert">Післяплата не може перевищувати оголошену вартість.</p>}
        <div className="shipment-quote" aria-live="polite">{quote ? <><strong>{quote.cost.toLocaleString('uk-UA')} грн</strong><span>{quote.estimatedDeliveryDate ? `Орієнтовна дата: ${quote.estimatedDeliveryDate}` : 'Вартість розраховано'}</span></> : <span>{completeDraft ? 'Розраховуємо вартість…' : 'Оберіть точне місто та відділення'}</span>}</div>
      </div>}
      <footer>
        <button type="button" className="secondary-button" disabled={state === 'creating'} onClick={onClose}>Скасувати</button>
        <LoadingButton type="button" pending={state === 'saving'} pendingLabel="Зберігаємо…" disabled={!completeDraft || state === 'saving' || state === 'creating' || (draft?.codAmount !== null && (draft?.codAmount ?? 0) > (draft?.declaredValue ?? 0))} onClick={() => void save()}>Зберегти чернетку</LoadingButton>
        <LoadingButton className="shipment-create-button" type="button" pending={state === 'creating'} pendingLabel="Створюємо ТТН…" disabled={!completeDraft || state === 'saving' || state === 'creating' || (draft?.codAmount !== null && (draft?.codAmount ?? 0) > (draft?.declaredValue ?? 0))} onClick={() => void create()}>Створити ТТН</LoadingButton>
      </footer>
    </section>
  </div>;
}

function formDraft(value: ShipmentDraftPrefill | ShipmentDraftInput): FormDraft {
  if ('destination' in value) return value;
  return { provider: value.provider, recipient: value.recipient, destination: null, parcels: value.parcels as [ShipmentDraftInput['parcels'][0]], payer: value.payer, declaredValue: value.declaredValue, codAmount: value.codAmount, description: value.description };
}

function Field({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
function withParcel(draft: FormDraft, key: keyof ShipmentDraftInput['parcels'][number], value: number): FormDraft {
  return { ...draft, parcels: [{ ...draft.parcels[0]!, [key]: value }] };
}
function blockedReasonLabel(reason: ShipmentOverview['blockedReason']): string {
  if (reason === 'ORDER_NOT_APPROVED') return 'Спочатку підтвердьте замовлення.';
  if (reason === 'PROCUREMENT_INCOMPLETE') return 'Дочекайтеся, поки всі товари будуть готові до відправлення.';
  if (reason === 'CONNECTION_REQUIRED') return 'Підключіть Нову Пошту в налаштуваннях.';
  return 'Заповніть дані відправника в налаштуваннях доставки.';
}
