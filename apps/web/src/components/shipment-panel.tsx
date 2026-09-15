'use client';

import type { ManagerOrder } from '../../../../packages/contracts/src/orders';
import type { ShipmentOverview } from '../../../../packages/contracts/src/delivery';
import { useEffect, useRef, useState } from 'react';

import { ShipmentReviewDialog } from './shipment-review-dialog';
import { ShipmentCustomerMessageDialog } from './shipment-customer-message-dialog';
import { useToast } from './toast-provider';
import { useConfirm } from './confirm-provider';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';

export function ShipmentPanel({ order }: { order: ManagerOrder }) {
  const [open, setOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [shipment, setShipment] = useState(order.shipment);
  const [cancelling, setCancelling] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const messageTrigger = useRef<HTMLButtonElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { t, formatNumber } = useI18n();
  const statusLabels: Record<string, string> = {
    DRAFT: t('orders.shipmentDraft'), CREATING: t('orders.shipmentCreating'), CREATED: t('orders.shipmentCreated'), ACCEPTED: t('orders.shipmentAccepted'),
    IN_TRANSIT: t('orders.shipmentInTransit'), DELIVERED: t('orders.shipmentDelivered'), RETURNING: t('orders.shipmentReturning'), RETURNED: t('orders.shipmentReturned'), CANCELLED: t('orders.shipmentCancelled'), FAILED: t('orders.shipmentFailed'),
  };
  const blocked = !order.canCreateShipment;
  const creationLocked = shipment !== null && shipment.status !== 'DRAFT' && shipment.status !== 'FAILED' && shipment.status !== 'CANCELLED';

  useEffect(() => {
    if (shipment?.status !== 'CREATING' && !cancelling) return;
    let active = true;
    const poll = () => void fetch(`/api/orders/${order.id}/shipments`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as ShipmentOverview : null)
      .then((overview) => { if (active && overview?.shipment) { setShipment(overview.shipment); if (overview.shipment.status === 'CANCELLED' || overview.shipment.provider === 'UKRPOSHTA' && overview.shipment.lastErrorCode) setCancelling(false); } })
      .catch(() => undefined);
    const timer = window.setInterval(poll, 2_000);
    poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [cancelling, order.id, shipment?.status]);

  async function cancelShipment() {
    if (!shipment || !await confirm({ title: t('orders.cancelTtnTitle'), description: t('orders.cancelTtnDescription'), confirmLabel: t('orders.cancelTtnConfirm'), tone: 'danger' })) return;
    setCancelling(true);
    const response = await mutatingFetch(`/api/shipments/${shipment.id}/cancel`, { method: 'POST' });
    if (!response.ok) { setCancelling(false); toast.show({ type: 'error', title: t('orders.cancelTtnFailed') }); return; }
    toast.show({ type: 'success', title: t('orders.cancelTtnStarted') });
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
      <span>{t('orders.shipmentSection')}</span>
      <h2 id="shipment-panel-title">{shipment?.provider === 'UKRPOSHTA' ? t('orders.ukrposhta') : shipment ? t('orders.novaPoshta') : t('orders.shipmentSetup')}</h2>
      <p>{shipment ? statusLabels[shipment.status] ?? shipment.status : blocked ? blockedCopy(order, t) : t('orders.shipmentReviewHint')}</p>
      {shipment?.trackingNumber && <strong>{t('orders.ttnNumber', { number: shipment.trackingNumber })}</strong>}
      {shipment?.cost != null && <span>{t('orders.amountUah', { amount: formatNumber(shipment.cost) })}</span>}
      {shipment?.lastErrorCode === 'UKRPOSHTA_OUTCOME_UNKNOWN' && <p role="status">{t('orders.ukrposhtaOutcomeUnknown')}</p>}
      {shipment?.provider === 'UKRPOSHTA' && shipment.lastErrorCode && shipment.lastErrorCode !== 'UKRPOSHTA_OUTCOME_UNKNOWN' && <p role="alert">{t('orders.ukrposhtaActionFailed')}</p>}
    </div>
    <div className="shipment-panel-actions">
      {shipment?.trackingNumber && <>
        {['CREATED', 'ACCEPTED', 'IN_TRANSIT'].includes(shipment.status) && <button ref={messageTrigger} className="secondary-button" type="button" onClick={() => setMessageOpen(true)}>{t('orders.notifyCustomer')}</button>}
        <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(shipment.trackingNumber!).then(() => toast.show({ type: 'success', title: t('orders.ttnCopied') }))}>{t('orders.copyTtn')}</button>
        <a className="secondary-button" href={`/api/shipments/${shipment.id}/label`}>{t('orders.downloadLabel')}</a>
        <a className="text-button" href={shipment.provider === 'UKRPOSHTA' ? `https://track.ukrposhta.ua/tracking_UA.html?barcode=${encodeURIComponent(shipment.trackingNumber)}` : `https://tracking.novaposhta.ua/#/uk/${shipment.trackingNumber}`} rel="noreferrer" target="_blank">{t('orders.trackShipment')}</a>
        {(shipment.provider === 'UKRPOSHTA' ? shipment.status === 'CREATED' && !shipment.lastErrorCode : !['DELIVERED', 'RETURNED', 'CANCELLED'].includes(shipment.status)) && <button className="danger-text-button" disabled={cancelling} type="button" onClick={() => void cancelShipment()}>{cancelling ? t('orders.cancellingTtn') : t('orders.cancelTtn')}</button>}
      </>}
      {!shipment?.trackingNumber && <button ref={trigger} className="secondary-button" type="button" disabled={blocked || creationLocked} onClick={() => setOpen(true)}>
        {shipment?.status === 'CREATING' ? t('orders.creatingTtn') : shipment?.status === 'DRAFT' ? t('orders.continueShipment') : t('orders.createShipment')}
      </button>}
    </div>
    {open && <ShipmentReviewDialog orderId={order.id} onClose={close} onSaved={setShipment} />}
    {messageOpen && shipment?.trackingNumber && <ShipmentCustomerMessageDialog shipmentId={shipment.id} trackingNumber={shipment.trackingNumber} onClose={closeMessage} onSubmitted={() => undefined} />}
  </section>;
}

function blockedCopy(order: ManagerOrder, t: ReturnType<typeof useI18n>['t']): string {
  if (!['APPROVED', 'AUTO_APPROVED'].includes(order.status)) return t('orders.shipmentOrderNotApproved');
  return t('orders.shipmentProcurementIncomplete');
}
