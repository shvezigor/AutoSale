'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import type { ShipmentOverview } from '../../../../packages/contracts/src/delivery';
import { useEffect, useRef, useState } from 'react';

import { ShipmentReviewDialog } from './shipment-review-dialog';
import { ShipmentCustomerMessageDialog } from './shipment-customer-message-dialog';
import { useToast } from './toast-provider';
import { useConfirm } from './confirm-provider';
import { mutatingFetch } from '../auth/csrf-fetch';

const statusLabels: Record<string, string> = {
  DRAFT: 'Чернетка доставки', CREATING: 'Створюємо ТТН', CREATED: 'ТТН створено', ACCEPTED: 'Прийнято перевізником',
  IN_TRANSIT: 'У дорозі', DELIVERED: 'Доставлено', RETURNING: 'Повертається', RETURNED: 'Повернено', CANCELLED: 'Скасовано', FAILED: 'Помилка доставки',
};

export function ShipmentPanel({ order }: { order: ManagerOrder }) {
  const [open, setOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [shipment, setShipment] = useState(order.shipment);
  const [cancelling, setCancelling] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const blocked = !order.canCreateShipment;
  const creationLocked = shipment !== null && shipment.status !== 'DRAFT' && shipment.status !== 'FAILED' && shipment.status !== 'CANCELLED';

  useEffect(() => {
    if (shipment?.status !== 'CREATING' && !cancelling) return;
    let active = true;
    const poll = () => void fetch(`/api/orders/${order.id}/shipments`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as ShipmentOverview : null)
      .then((overview) => { if (active && overview?.shipment) { setShipment(overview.shipment); if (overview.shipment.status === 'CANCELLED') setCancelling(false); } })
      .catch(() => undefined);
    const timer = window.setInterval(poll, 2_000);
    poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [cancelling, order.id, shipment?.status]);

  async function cancelShipment() {
    if (!shipment || !await confirm({ title: 'Скасувати ТТН?', description: 'Нова Пошта скасує це відправлення. Історія залишиться в AutoSale.', confirmLabel: 'Так, скасувати', tone: 'danger' })) return;
    setCancelling(true);
    const response = await mutatingFetch(`/api/shipments/${shipment.id}/cancel`, { method: 'POST' });
    if (!response.ok) { setCancelling(false); toast.show({ type: 'error', title: 'Не вдалося скасувати ТТН' }); return; }
    toast.show({ type: 'success', title: 'Скасування ТТН розпочато' });
  }

  function close() {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  function closeMessage() {
    setMessageOpen(false);
    window.setTimeout(() => messageTrigger.current?.focus(), 0);
  }

  return <section className="shipment-panel" aria-labelledby="shipment-panel-title">
    <div>
      <span>Доставка</span>
      <h2 id="shipment-panel-title">Нова Пошта</h2>
      <p>{shipment ? statusLabels[shipment.status] ?? shipment.status : blocked ? blockedCopy(order) : 'Перевірте дані й розрахуйте вартість перед створенням ТТН.'}</p>
      {shipment?.trackingNumber && <strong>ТТН {shipment.trackingNumber}</strong>}
    </div>
    <div className="shipment-panel-actions">
      {shipment?.trackingNumber && <>
        {['CREATED', 'ACCEPTED', 'IN_TRANSIT'].includes(shipment.status) && <button ref={messageTrigger} className="secondary-button" type="button" onClick={() => setMessageOpen(true)}>Повідомити клієнта</button>}
        <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(shipment.trackingNumber!).then(() => toast.show({ type: 'success', title: 'Номер ТТН скопійовано' }))}>Скопіювати ТТН</button>
        <a className="secondary-button" href={`/api/shipments/${shipment.id}/label`}>Завантажити етикетку</a>
        <a className="text-button" href={`https://tracking.novaposhta.ua/#/uk/${shipment.trackingNumber}`} rel="noreferrer" target="_blank">Відстежити</a>
        {!['DELIVERED', 'RETURNED', 'CANCELLED'].includes(shipment.status) && <button className="danger-text-button" disabled={cancelling} type="button" onClick={() => void cancelShipment()}>{cancelling ? 'Скасовуємо…' : 'Скасувати ТТН'}</button>}
      </>}
      {!shipment?.trackingNumber && <button ref={trigger} className="secondary-button" type="button" disabled={blocked || creationLocked} onClick={() => setOpen(true)}>
        {shipment?.status === 'CREATING' ? 'Створюємо ТТН…' : shipment?.status === 'DRAFT' ? 'Продовжити оформлення' : 'Оформити доставку'}
      </button>}
    </div>
    {open && <ShipmentReviewDialog orderId={order.id} onClose={close} onSaved={setShipment} />}
    {messageOpen && shipment?.trackingNumber && <ShipmentCustomerMessageDialog shipmentId={shipment.id} trackingNumber={shipment.trackingNumber} onClose={closeMessage} onSubmitted={() => undefined} />}
  </section>;
}

function blockedCopy(order: ManagerOrder): string {
  if (!['APPROVED', 'AUTO_APPROVED'].includes(order.status)) return 'Спочатку підтвердьте замовлення.';
  return 'Доставка стане доступною, коли всі товари будуть на складі або отримані від постачальника.';
}
