'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import type { ProcurementStatus } from '../../../../packages/contracts/src/procurement';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

type Item = ManagerOrder['items'][number];
type ManualStatus = 'IN_STOCK' | 'TO_ORDER' | 'SUPPLIER_CONFIRMED' | 'RECEIVED' | 'UNAVAILABLE';

const statusLabels: Record<ProcurementStatus, string> = {
  UNASSESSED: 'Ще не перевірено',
  IN_STOCK: 'Є на складі',
  TO_ORDER: 'Потрібно замовити',
  SENDING: 'Відправляється постачальнику',
  ORDERED: 'Замовлено у постачальника',
  SUPPLIER_CONFIRMED: 'Постачальник підтвердив',
  RECEIVED: 'Отримано від постачальника',
  UNAVAILABLE: 'Недоступно',
};

const actions: Partial<Record<ProcurementStatus, Array<{ label: string; status: ManualStatus }>>> = {
  UNASSESSED: [{ label: 'Є на складі', status: 'IN_STOCK' }, { label: 'Замовити у постачальника', status: 'TO_ORDER' }],
  IN_STOCK: [{ label: 'Замовити у постачальника', status: 'TO_ORDER' }],
  TO_ORDER: [{ label: 'Позначити на складі', status: 'IN_STOCK' }],
  ORDERED: [{ label: 'Постачальник підтвердив', status: 'SUPPLIER_CONFIRMED' }, { label: 'Товар отримано', status: 'RECEIVED' }],
  SUPPLIER_CONFIRMED: [{ label: 'Товар отримано', status: 'RECEIVED' }],
  UNAVAILABLE: [{ label: 'Позначити на складі', status: 'IN_STOCK' }, { label: 'Замовити у постачальника', status: 'TO_ORDER' }],
};

export function ProcurementItemCard({
  item,
  orderId,
  onOrderChange,
  locked = false,
}: {
  item: Item;
  orderId: string;
  onOrderChange(order: ManagerOrder): void;
  locked?: boolean;
}) {
  const [pendingStatus, setPendingStatus] = useState<ManualStatus | null>(null);
  const activity = useActivity();
  const toast = useToast();
  const itemActions = actions[item.procurementStatus] ?? [];
  const disabled = locked || item.procurementStatus === 'SENDING' || pendingStatus !== null;

  async function changeStatus(status: ManualStatus) {
    setPendingStatus(status);
    try {
      const response = await activity.run('Оновлюємо комплектацію', () => mutatingFetch(
        `/api/orders/${orderId}/items/${item.id}/procurement`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      ));
      if (!response.ok) throw new Error('procurement update failed');
      onOrderChange(await response.json() as ManagerOrder);
      toast.show({ type: 'success', title: 'Статус товару оновлено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося оновити комплектацію', message: 'Спробуйте ще раз.' });
    } finally {
      setPendingStatus(null);
    }
  }

  return <section className="procurement-item-card" aria-label="Комплектація товару">
    <div className="procurement-item-state">
      <strong>Комплектація</strong>
      <span className={`procurement-badge procurement-${item.procurementStatus.toLowerCase()}`}>{statusLabels[item.procurementStatus]}</span>
    </div>
    <p>{reasonText(item)}</p>
    {itemActions.length > 0 && !locked && <div className="procurement-item-actions">
      {itemActions.map((action) => <LoadingButton
        className="secondary procurement-action"
        disabled={disabled}
        key={action.status}
        onClick={() => void changeStatus(action.status)}
        pending={pendingStatus === action.status}
        pendingLabel="Змінюємо…"
        type="button"
      >{action.label}</LoadingButton>)}
    </div>}
  </section>;
}

function reasonText(item: Item): string {
  if (item.procurementReason === 'STOCK_AVAILABLE' && item.stockAtDecision !== null) {
    return `Доступно ${item.availableAtDecision ?? item.stockAtDecision} із ${item.stockAtDecision} од. · зарезервовано ${item.reservation?.quantity ?? item.quantity}`;
  }
  const descriptions: Partial<Record<NonNullable<Item['procurementReason']>, string>> = {
    STOCK_INSUFFICIENT: 'Залишку недостатньо для цього замовлення',
    STOCK_UNKNOWN: 'Залишок товару не вказано',
    PRODUCT_UNMATCHED: 'Товар не зіставлено з каталогом',
    RESERVATION_CONFLICT: 'Товар одночасно зарезервували в іншому замовленні',
    MANUAL_IN_STOCK: 'Менеджер підтвердив наявність',
    MANUAL_TO_ORDER: 'Менеджер вирішив замовити у постачальника',
    DELIVERY_FAILED: 'Не вдалося передати постачальнику — можна повторити',
  };
  return descriptions[item.procurementReason ?? 'STOCK_UNKNOWN'] ?? 'Статус комплектації визначено';
}
