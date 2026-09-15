'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import type { ProcurementStatus } from '../../../../packages/contracts/src/procurement';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';

type Item = ManagerOrder['items'][number];
type ManualStatus = 'IN_STOCK' | 'TO_ORDER' | 'SUPPLIER_CONFIRMED' | 'RECEIVED' | 'UNAVAILABLE';

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
  const { t, formatNumber } = useI18n();
  const actions: Partial<Record<ProcurementStatus, Array<{ label: string; status: ManualStatus }>>> = {
    UNASSESSED: [{ label: t('orders.inStock'), status: 'IN_STOCK' }, { label: t('orders.orderSupplier'), status: 'TO_ORDER' }],
    IN_STOCK: [{ label: t('orders.orderSupplier'), status: 'TO_ORDER' }],
    TO_ORDER: [{ label: t('orders.markInStock'), status: 'IN_STOCK' }],
    ORDERED: [{ label: t('orders.supplierConfirmed'), status: 'SUPPLIER_CONFIRMED' }, { label: t('orders.productReceived'), status: 'RECEIVED' }],
    SUPPLIER_CONFIRMED: [{ label: t('orders.productReceived'), status: 'RECEIVED' }],
    UNAVAILABLE: [{ label: t('orders.markInStock'), status: 'IN_STOCK' }, { label: t('orders.orderSupplier'), status: 'TO_ORDER' }],
  };
  const itemActions = actions[item.procurementStatus] ?? [];
  const disabled = locked || item.procurementStatus === 'SENDING' || pendingStatus !== null;

  async function changeStatus(status: ManualStatus) {
    setPendingStatus(status);
    try {
      const response = await activity.run(t('orders.updatingProcurement'), () => mutatingFetch(
        `/api/orders/${orderId}/items/${item.id}/procurement`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      ));
      if (!response.ok) throw new Error('procurement update failed');
      onOrderChange(await response.json() as ManagerOrder);
      toast.show({ type: 'success', title: t('orders.procurementUpdated') });
    } catch {
      toast.show({ type: 'error', title: t('orders.procurementUpdateFailed'), message: t('catalogue.tryAgain') });
    } finally {
      setPendingStatus(null);
    }
  }

  return <section className="procurement-item-card" aria-label={t('orders.procurementRegion')}>
    <div className="procurement-item-state">
      <strong>{t('orders.procurementTitle')}</strong>
      <span className={`procurement-badge procurement-${item.procurementStatus.toLowerCase()}`}>{procurementStatusLabel(item.procurementStatus, t)}</span>
    </div>
    <p>{reasonText(item, t, formatNumber)}</p>
    {itemActions.length > 0 && !locked && <div className="procurement-item-actions">
      {itemActions.map((action) => <LoadingButton
        className="secondary procurement-action"
        disabled={disabled}
        key={action.status}
        onClick={() => void changeStatus(action.status)}
        pending={pendingStatus === action.status}
        pendingLabel={t('orders.changing')}
        type="button"
      >{action.label}</LoadingButton>)}
    </div>}
  </section>;
}

function reasonText(item: Item, t: Translator, formatNumber: (value: number) => string): string {
  if (item.procurementReason === 'STOCK_AVAILABLE' && item.stockAtDecision !== null) {
    return t('orders.stockAvailable', { available: formatNumber(item.availableAtDecision ?? item.stockAtDecision), stock: formatNumber(item.stockAtDecision), reserved: formatNumber(item.reservation?.quantity ?? item.quantity) });
  }
  const descriptions: Partial<Record<NonNullable<Item['procurementReason']>, string>> = {
    STOCK_INSUFFICIENT: t('orders.stockInsufficient'),
    STOCK_UNKNOWN: t('orders.stockUnknown'),
    PRODUCT_UNMATCHED: t('orders.productUnmatched'),
    RESERVATION_CONFLICT: t('orders.reservationConflict'),
    MANUAL_IN_STOCK: t('orders.manualInStock'),
    MANUAL_TO_ORDER: t('orders.manualToOrder'),
    DELIVERY_FAILED: t('orders.supplierDeliveryFailed'),
  };
  return descriptions[item.procurementReason ?? 'STOCK_UNKNOWN'] ?? t('orders.procurementDetermined');
}

function procurementStatusLabel(status: ProcurementStatus, t: Translator): string {
  return ({ UNASSESSED: t('orders.procurementUnassessed'), IN_STOCK: t('orders.inStock'), TO_ORDER: t('orders.toOrder'), SENDING: t('orders.sendingSupplier'), ORDERED: t('orders.orderedSupplier'), SUPPLIER_CONFIRMED: t('orders.supplierConfirmed'), RECEIVED: t('orders.receivedSupplier'), UNAVAILABLE: t('orders.unavailable') } satisfies Record<ProcurementStatus, string>)[status];
}
