'use client';

import type { ShipmentCustomerMessagePreview } from '../../../../packages/contracts/src/delivery';
import { useEffect, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export function ShipmentCustomerMessageDialog({
  shipmentId,
  trackingNumber,
  onClose,
  onSubmitted,
}: {
  shipmentId: string;
  trackingNumber: string;
  onClose(): void;
  onSubmitted(): void;
}) {
  const [preview, setPreview] = useState<ShipmentCustomerMessagePreview | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    void fetch(`/api/shipments/${shipmentId}/customer-message`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('preview failed');
        const value = await response.json() as ShipmentCustomerMessagePreview;
        if (active) { setPreview(value); setText(value.text); }
      })
      .catch(() => { if (active) setError(t('orders.customerMessagePrepareFailed')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [shipmentId, t]);

  useEffect(() => {
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, sending]);

  const alreadySent = preview?.alreadySubmitted ?? false;
  const deliveryFailed = alreadySent && preview?.deliveryStatus === 'FAILED';
  const submittedLabel = preview?.deliveryStatus === 'SENT' ? t('orders.customerMessageSent') : t('orders.customerMessageQueued');

  async function submit() {
    const message = text.trim();
    if (!message || message.length > 1_000 || sending || alreadySent) return;
    setSending(true); setError(null);
    try {
      const response = await mutatingFetch(`/api/shipments/${shipmentId}/customer-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
      if (!response.ok) throw new Error('send failed');
      toast.show({ type: 'success', title: t('orders.customerMessageSending') });
      onSubmitted();
      onClose();
    } catch {
      setError(t('orders.customerMessageSendFailed'));
      toast.show({ type: 'error', title: t('orders.customerMessageNotSent') });
    } finally {
      setSending(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ type: 'success', title: t('orders.textCopied') });
    } catch {
      toast.show({ type: 'error', title: t('orders.textCopyFailed') });
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !sending) onClose();
  }}>
    <section aria-labelledby="shipment-customer-message-title" aria-modal="true" className="supplier-dispatch-dialog shipment-customer-message-dialog" role="dialog">
      <header>
        <div><span>Instagram</span><h2 id="shipment-customer-message-title">{t('orders.customerMessageTitle')}</h2></div>
        <button ref={closeButton} aria-label={t('orders.close')} className="icon-button" disabled={sending} onClick={onClose} type="button">×</button>
      </header>
      <p className="shipment-customer-message-tracking">{t('orders.ttnNumber', { number: trackingNumber })}</p>
      {loading && <div className="dialog-loading" role="status"><span className="button-spinner" aria-hidden="true" /> {t('orders.preparingCustomerMessage')}</div>}
      {error && <div className="dialog-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => void copyText()} type="button">{t('orders.copyText')}</button></div>}
      {preview && <>
        {deliveryFailed
          ? <div className="dialog-error" role="alert"><p>{t('orders.instagramDeliveryFailed')}</p><button className="secondary-button" onClick={() => void copyText()} type="button">{t('orders.copyText')}</button></div>
          : alreadySent && <p className="dialog-success" role="status">{submittedLabel}</p>}
        {!preview.suggested && !alreadySent && <p className="dialog-note">{t('orders.automaticSuggestionDisabled')}</p>}
        <label className="shipment-customer-message-field">
          <span>{t('orders.customerMessage')}</span>
          <textarea aria-label={t('orders.customerMessage')} disabled={sending || alreadySent} maxLength={1_000} onChange={(event) => setText(event.target.value)} rows={6} value={text} />
          <small>{text.length} / 1000</small>
        </label>
      </>}
      <footer>
        <button className="secondary-button" disabled={sending} onClick={onClose} type="button">{t('orders.cancel')}</button>
        <LoadingButton className={preview?.suggested === false ? 'secondary-button' : ''} disabled={!preview || !text.trim() || alreadySent} onClick={() => void submit()} pending={sending} pendingLabel={t('orders.sendingCustomerMessage')} type="button">
          {deliveryFailed ? t('orders.notDelivered') : alreadySent ? t('orders.sentToCustomer') : t('orders.sendToCustomer')}
        </LoadingButton>
      </footer>
    </section>
  </div>;
}
