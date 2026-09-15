'use client';

import { isUkrposhtaPersonName, type DeliveryLocation, type ShipmentDraftInput, type ShipmentDraftPrefill, type ShipmentOverview, type ShipmentQuote, type ShipmentSummary } from '../../../../packages/contracts/src/delivery';
import { useEffect, useMemo, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

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
  const [provider, setProvider] = useState<'NOVA_POSHTA' | 'UKRPOSHTA' | null>(null);
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const [city, setCity] = useState<DeliveryLocation | null>(null);
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [destinationType, setDestinationType] = useState<'BRANCH' | 'PARCEL_LOCKER'>('BRANCH');
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'creating' | 'error'>('loading');
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const toast = useToast();
  const { t, formatNumber } = useI18n();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
      if (focusable.length === 0) { event.preventDefault(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/orders/${orderId}/shipments${provider ? `?provider=${provider}` : ''}`, { credentials: 'same-origin', cache: 'no-store' })
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
          setCity({ ref: destination.cityRef, provider: value.draft.provider, type: 'CITY', label: destination.cityRef });
          if (destination.type !== 'ADDRESS') {
            setDestinationType(destination.type);
            setLocation({ ref: destination.locationRef, provider: value.draft.provider, type: destination.type, label: destination.label, cityRef: destination.cityRef });
          }
        }
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [orderId, provider]);

  const completeDraft = useMemo(() => {
    if (!draft || !city || !location || !draft.recipient.name || !draft.recipient.phone) return null;
    if (draft.provider === 'UKRPOSHTA' && !isUkrposhtaPersonName(draft.recipient.name)) return null;
    return {
      ...draft,
      recipient: { name: draft.recipient.name, phone: draft.recipient.phone },
      destination: { type: location.type as 'BRANCH' | 'PARCEL_LOCKER', cityRef: city.ref, locationRef: location.ref, label: location.label },
    } satisfies ShipmentDraftInput;
  }, [city, draft, location]);

  useEffect(() => {
    setQuote(null);
    setQuoteFailed(false);
    if (!completeDraft) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void mutatingFetch(`/api/orders/${orderId}/shipments/quote`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(completeDraft), signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error('quote');
        return await response.json() as ShipmentQuote;
      }).then((value) => { if (!controller.signal.aborted) setQuote(value); }).catch(() => { if (!controller.signal.aborted) { setQuote(null); setQuoteFailed(true); } });
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
      toast.show({ type: 'success', title: t('orders.shipmentDraftSaved') });
      onClose();
    } catch {
      setState('ready');
      toast.show({ type: 'error', title: t('orders.shipmentSaveFailed') });
    }
  }

  async function create() {
    if (!completeDraft || state === 'creating' || overview?.creationEnabled === false || draft?.provider === 'UKRPOSHTA' && !quote) return;
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
      toast.show({ type: 'success', title: t('orders.ttnCreationStarted') });
      onClose();
    } catch {
      setState('ready');
      toast.show({ type: 'error', title: t('orders.ttnCreationFailed') });
    }
  }

  return <div className="modal-backdrop shipment-dialog-backdrop" role="presentation">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="shipment-dialog-title" className="shipment-review-dialog">
      <header><div><span>{draft?.provider === 'UKRPOSHTA' ? t('orders.ukrposhta') : t('orders.novaPoshta')}</span><h2 id="shipment-dialog-title">{t('orders.shipmentSetup')}</h2></div><button ref={closeButton} className="icon-button" type="button" aria-label={t('orders.close')} onClick={onClose}>×</button></header>
      {overview?.availableProviders && overview.availableProviders.length > 0 && <label><span>{t('orders.carrier')}</span><select aria-label={t('orders.carrier')} disabled={state !== 'ready'} value={provider ?? draft?.provider ?? 'NOVA_POSHTA'} onChange={(event) => { setProvider(event.target.value as 'NOVA_POSHTA' | 'UKRPOSHTA'); setDraft(null); setCity(null); setLocation(null); setDestinationType('BRANCH'); setQuote(null); setState('loading'); }}>
        {overview.availableProviders.map((value) => <option key={value} value={value}>{value === 'UKRPOSHTA' ? t('orders.ukrposhta') : t('orders.novaPoshta')}</option>)}
      </select></label>}
      {overview?.creationEnabled === false && <p className="delivery-readonly-note">{t('orders.ukrposhtaReadonly')}</p>}
      {state === 'loading' && <div className="dialog-loading"><span className="button-spinner" aria-hidden="true" /> {t('orders.loadingShipment')}</div>}
      {state === 'error' && <p className="dialog-error" role="alert">{t('orders.shipmentSettingsFailed')}</p>}
      {overview && !overview.canCreateShipment && <p className="dialog-error">{blockedReasonLabel(overview.blockedReason, t)}</p>}
      {draft && overview?.canCreateShipment && <div className="shipment-form">
        <div className="shipment-form-grid">
          <Field label={t('orders.recipientName')} value={draft.recipient.name ?? ''} onChange={(value) => setDraft({ ...draft, recipient: { ...draft.recipient, name: value } })} />
          {draft.provider === 'UKRPOSHTA' && <p>{t('orders.ukrposhtaNameHint')}</p>}
          <Field label={t('orders.recipientPhone')} value={draft.recipient.phone ?? ''} onChange={(value) => setDraft({ ...draft, recipient: { ...draft.recipient, phone: value } })} />
          <DeliveryLocationPicker key={`${draft.provider}-city`} provider={draft.provider} label={t('orders.city')} type="CITY" initialQuery={'cityHint' in overview.draft! ? overview.draft.cityHint ?? '' : ''} value={city} onSelect={(value) => { setCity(value); setLocation(null); }} />
          <label><span>{t('orders.destinationType')}</span><select aria-label={t('orders.destinationType')} value={destinationType} onChange={(event) => { setDestinationType(event.target.value as 'BRANCH' | 'PARCEL_LOCKER'); setLocation(null); }}><option value="BRANCH">{t('orders.branch')}</option>{draft.provider !== 'UKRPOSHTA' && <option value="PARCEL_LOCKER">{t('orders.parcelLocker')}</option>}</select></label>
          <DeliveryLocationPicker key={`${draft.provider}-${destinationType}`} provider={draft.provider} label={t('orders.branchOrLocker')} type={destinationType} {...(city ? { cityRef: city.ref } : {})} initialQuery={'locationHint' in overview.draft! ? overview.draft.locationHint ?? '' : ''} value={location} onSelect={setLocation} />
          <label><span>{t('orders.shipmentPayer')}</span><select aria-label={t('orders.shipmentPayer')} value={draft.payer} onChange={(event) => setDraft({ ...draft, payer: event.target.value as 'SENDER' | 'RECIPIENT' })}><option value="SENDER">{t('orders.sender')}</option><option value="RECIPIENT">{t('orders.recipient')}</option></select></label>
          <Field label={t('orders.shipmentDescription')} value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
        </div>
        <div className="shipment-parcel-grid">
          <NumberField label={t('orders.weightKg')} value={draft.parcels[0]!.weightKg} onChange={(value) => setDraft(withParcel(draft, 'weightKg', value))} />
          <NumberField label={t('orders.lengthCm')} value={draft.parcels[0]!.lengthCm} onChange={(value) => setDraft(withParcel(draft, 'lengthCm', value))} />
          <NumberField label={t('orders.widthCm')} value={draft.parcels[0]!.widthCm} onChange={(value) => setDraft(withParcel(draft, 'widthCm', value))} />
          <NumberField label={t('orders.heightCm')} value={draft.parcels[0]!.heightCm} onChange={(value) => setDraft(withParcel(draft, 'heightCm', value))} />
          <NumberField label={t('orders.declaredValueUah')} value={draft.declaredValue} onChange={(value) => setDraft({ ...draft, declaredValue: value })} />
          <NumberField label={t('orders.codAmountUah')} value={draft.codAmount ?? 0} onChange={(value) => setDraft({ ...draft, codAmount: value > 0 ? value : null })} />
        </div>
        {draft.codAmount !== null && draft.codAmount > draft.declaredValue && <p className="shipment-validation" role="alert">{t('orders.codTooHigh')}</p>}
        <div className="shipment-quote" aria-live="polite">{quote ? <><strong>{t('orders.amountUah', { amount: formatNumber(quote.cost) })}</strong><span>{draft.provider === 'UKRPOSHTA' ? t('orders.estimatedCostFinalLater') : quote.estimatedDeliveryDate ? t('orders.estimatedDate', { date: quote.estimatedDeliveryDate }) : t('orders.costCalculated')}</span></> : <span>{quoteFailed ? t('orders.quoteFailed') : completeDraft ? t('orders.calculatingCost') : t('orders.selectExactDestination')}</span>}</div>
      </div>}
      <footer>
        <button type="button" className="secondary-button" disabled={state === 'creating'} onClick={onClose}>{t('orders.cancel')}</button>
        <LoadingButton type="button" pending={state === 'saving'} pendingLabel={t('orders.savingShipmentDraft')} disabled={!completeDraft || state === 'saving' || state === 'creating' || (draft?.codAmount !== null && (draft?.codAmount ?? 0) > (draft?.declaredValue ?? 0))} onClick={() => void save()}>{t('orders.saveShipmentDraft')}</LoadingButton>
        <LoadingButton className="shipment-create-button" type="button" pending={state === 'creating'} pendingLabel={t('orders.creatingTtn')} disabled={!completeDraft || overview?.creationEnabled === false || draft?.provider === 'UKRPOSHTA' && !quote || state === 'saving' || state === 'creating' || (draft?.codAmount !== null && (draft?.codAmount ?? 0) > (draft?.declaredValue ?? 0))} onClick={() => void create()}>{t('orders.createTtn')}</LoadingButton>
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
function blockedReasonLabel(reason: ShipmentOverview['blockedReason'], t: ReturnType<typeof useI18n>['t']): string {
  if (reason === 'ORDER_NOT_APPROVED') return t('orders.shipmentOrderNotApproved');
  if (reason === 'PROCUREMENT_INCOMPLETE') return t('orders.shipmentItemsNotReady');
  if (reason === 'CONNECTION_REQUIRED') return t('orders.shipmentConnectionRequired');
  return t('orders.shipmentSenderRequired');
}
