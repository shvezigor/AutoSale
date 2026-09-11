'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import { useRef, useState } from 'react';

import { ShipmentReviewDialog } from './shipment-review-dialog';

const statusLabels: Record<string, string> = {
  DRAFT: 'Чернетка доставки', CREATING: 'Створюємо ТТН', CREATED: 'ТТН створено', ACCEPTED: 'Прийнято перевізником',
  IN_TRANSIT: 'У дорозі', DELIVERED: 'Доставлено', RETURNING: 'Повертається', RETURNED: 'Повернено', CANCELLED: 'Скасовано', FAILED: 'Помилка доставки',
};

export function ShipmentPanel({ order }: { order: ManagerOrder }) {
  const [open, setOpen] = useState(false);
  const [shipment, setShipment] = useState(order.shipment);
  const trigger = useRef<HTMLButtonElement>(null);
  const blocked = !order.canCreateShipment;

  function close() {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }

  return <section className="shipment-panel" aria-labelledby="shipment-panel-title">
    <div>
      <span>Доставка</span>
      <h2 id="shipment-panel-title">Нова Пошта</h2>
      <p>{shipment ? statusLabels[shipment.status] ?? shipment.status : blocked ? blockedCopy(order) : 'Перевірте дані й розрахуйте вартість перед створенням ТТН.'}</p>
      {shipment?.trackingNumber && <strong>ТТН {shipment.trackingNumber}</strong>}
    </div>
    <button ref={trigger} className="secondary-button" type="button" disabled={blocked} onClick={() => setOpen(true)}>
      {shipment?.status === 'DRAFT' ? 'Продовжити оформлення' : 'Оформити доставку'}
    </button>
    {open && <ShipmentReviewDialog orderId={order.id} onClose={close} onSaved={setShipment} />}
  </section>;
}

function blockedCopy(order: ManagerOrder): string {
  if (!['APPROVED', 'AUTO_APPROVED'].includes(order.status)) return 'Спочатку підтвердьте замовлення.';
  return 'Доставка стане доступною, коли всі товари будуть на складі або отримані від постачальника.';
}
