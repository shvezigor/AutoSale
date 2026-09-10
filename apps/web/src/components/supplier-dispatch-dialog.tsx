'use client';

import type { SupplierOrderPreview } from '../../../../packages/contracts/src/procurement';
import { useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

type DeliveryResult = { deliveryId: string; status: string };

export function SupplierDispatchDialog({
  open,
  orderId,
  onClose,
  onDispatched,
}: {
  open: boolean;
  orderId: string;
  onClose(): void;
  onDispatched(result: DeliveryResult): void;
}) {
  const [preview, setPreview] = useState<SupplierOrderPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activity = useActivity();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setPreview(null);
    void fetch(`/api/integrations/telegram/supplier/orders/${orderId}/preview`)
      .then(async (response) => {
        if (!response.ok) throw new Error('preview failed');
        const value = await response.json() as SupplierOrderPreview;
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setError('Не вдалося підготувати замовлення. Перевірте чат постачальника в налаштуваннях.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, orderId]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open, sending]);

  if (!open) return null;

  async function confirm() {
    if (!preview || sending) return;
    setSending(true); setError(null);
    try {
      const response = await activity.run('Надсилаємо замовлення постачальнику', () => mutatingFetch(
        `/api/integrations/telegram/supplier/orders/${orderId}`,
        { method: 'POST' },
      ));
      if (!response.ok) throw new Error('dispatch failed');
      const result = await response.json() as DeliveryResult;
      onDispatched(result);
      toast.show({ type: 'success', title: 'Замовлення передається постачальнику' });
      onClose();
    } catch {
      setError('Не вдалося надіслати замовлення. Спробуйте ще раз.');
      toast.show({ type: 'error', title: 'Замовлення не надіслано' });
    } finally {
      setSending(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !sending) onClose();
  }}>
    <section aria-labelledby="supplier-dispatch-title" aria-modal="true" className="supplier-dispatch-dialog" role="dialog">
      <header>
        <div><span>Перевірка перед відправленням</span><h2 id="supplier-dispatch-title">Надіслати замовлення постачальнику</h2></div>
        <button aria-label="Закрити" className="icon-button" disabled={sending} onClick={onClose} type="button">×</button>
      </header>
      {loading && <div className="dialog-loading" role="status"><span className="button-spinner" aria-hidden="true" /> Готуємо замовлення…</div>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      {preview && <>
        <dl className="supplier-dispatch-meta">
          <div><dt>Від компанії</dt><dd>{preview.companyName}</dd></div>
          <div><dt>Кому</dt><dd>{preview.supplierName}</dd></div>
        </dl>
        <div className="supplier-dispatch-items">
          <strong>Товари до замовлення · {preview.items.length}</strong>
          <ul>{preview.items.map((item) => <li key={item.orderItemId}>
            <div><strong>{item.productName}</strong><span>{[item.sku, item.size, item.color].filter(Boolean).join(' · ')}</span></div>
            <b>{item.quantity} шт.</b>
          </li>)}</ul>
        </div>
      </>}
      <footer>
        <button className="secondary-button" disabled={sending} onClick={onClose} type="button">Скасувати</button>
        <LoadingButton disabled={!preview || loading || sending} onClick={() => void confirm()} pending={sending} pendingLabel="Надсилаємо…" type="button">Надіслати</LoadingButton>
      </footer>
    </section>
  </div>;
}
