'use client';

import type { ManagerOrder, OrderStatus } from '../../../../packages/contracts/src/orders';
import type { ProcurementSummary } from '../../../../packages/contracts/src/procurement';
import type { ShipmentStatus } from '../../../../packages/contracts/src/delivery';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, MouseEvent, useState } from 'react';

import { TablePagination } from './table-pagination';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';

type OrdersTableProps = { orders: ManagerOrder[]; page: number; pageSize: number; total: number; search?: string; status?: OrderStatus; procurementStatus?: ProcurementSummary; shipmentStatus?: ShipmentStatus };

export function OrdersTable({ orders, page, pageSize, total, search = '', status, procurementStatus, shipmentStatus }: OrdersTableProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | ''>(status ?? '');
  const [selectedProcurement, setSelectedProcurement] = useState<ProcurementSummary | ''>(procurementStatus ?? '');
  const [selectedShipment, setSelectedShipment] = useState<ShipmentStatus | ''>(shipmentStatus ?? '');
  const navigate = (nextPage: number, nextPageSize = pageSize, nextStatus = selectedStatus, nextProcurement = selectedProcurement, nextShipment = selectedShipment) => router.replace(ordersUrl(query, nextStatus, nextProcurement, nextShipment, nextPage, nextPageSize), { scroll: false });
  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); navigate(1); };
  const changeStatus = (value: OrderStatus | '') => { setSelectedStatus(value); navigate(1, pageSize, value); };
  const changeProcurement = (value: ProcurementSummary | '') => { setSelectedProcurement(value); navigate(1, pageSize, selectedStatus, value); };
  const returnTo = ordersUrl(search, status ?? '', procurementStatus ?? '', shipmentStatus ?? '', page, pageSize);
  const statuses: Array<{ value: OrderStatus | ''; label: string }> = [
    { value: '', label: t('orders.allStatuses') }, { value: 'NEEDS_REVIEW', label: t('orders.needsReview') }, { value: 'AUTO_APPROVED', label: t('orders.autoApproved') }, { value: 'APPROVED', label: t('orders.approved') }, { value: 'AI_PROCESSING', label: t('orders.aiProcessing') }, { value: 'AI_FAILED', label: t('orders.aiFailed') }, { value: 'CANCELLED', label: t('orders.cancelled') },
  ];
  const procurementStatuses: Array<{ value: ProcurementSummary | ''; label: string }> = [
    { value: '', label: t('orders.allProcurement') }, { value: 'UNASSESSED', label: t('orders.unassessed') }, { value: 'READY', label: t('orders.ready') }, { value: 'PARTIALLY_READY', label: t('orders.partiallyReady') }, { value: 'NEEDS_ORDER', label: t('orders.needsOrder') }, { value: 'SENDING', label: t('orders.sending') }, { value: 'AWAITING_SUPPLIER', label: t('orders.awaitingSupplier') }, { value: 'BLOCKED', label: t('orders.blocked') }, { value: 'HANDED_OFF', label: t('orders.handedOff') },
  ];
  const shipmentStatuses: Array<{ value: ShipmentStatus | ''; label: string }> = [
    { value: '', label: t('orders.allShipments') }, { value: 'DRAFT', label: t('orders.draft') }, { value: 'CREATING', label: t('orders.creating') }, { value: 'CREATED', label: t('orders.created') }, { value: 'ACCEPTED', label: t('orders.accepted') }, { value: 'IN_TRANSIT', label: t('orders.inTransit') }, { value: 'DELIVERED', label: t('orders.delivered') }, { value: 'RETURNING', label: t('orders.returning') }, { value: 'RETURNED', label: t('orders.returned') }, { value: 'CANCELLED', label: t('orders.cancelled') }, { value: 'FAILED', label: t('orders.failed') },
  ];

  return <>
    <div className="orders-toolbar">
      <form onSubmit={submitSearch} role="search"><label className="sr-only" htmlFor="orders-search">{t('orders.searchLabel')}</label><input id="orders-search" onChange={(event) => setQuery(event.target.value)} placeholder={t('orders.searchPlaceholder')} type="search" value={query} /><button className="secondary-button" type="submit">{t('orders.search')}</button></form>
      <label className="orders-status-filter"><span className="sr-only">{t('orders.orderStatus')}</span><select aria-label={t('orders.orderStatus')} onChange={(event) => changeStatus(event.target.value as OrderStatus | '')} value={selectedStatus}>{statuses.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label>
      <label className="orders-status-filter"><span className="sr-only">{t('orders.procurement')}</span><select aria-label={t('orders.procurement')} onChange={(event) => changeProcurement(event.target.value as ProcurementSummary | '')} value={selectedProcurement}>{procurementStatuses.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label>
      <label className="orders-status-filter"><span className="sr-only">{t('orders.shipmentStatus')}</span><select aria-label={t('orders.shipmentStatus')} onChange={(event) => { const value = event.target.value as ShipmentStatus | ''; setSelectedShipment(value); navigate(1, pageSize, selectedStatus, selectedProcurement, value); }} value={selectedShipment}>{shipmentStatuses.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label>
    </div>
    {orders.length === 0 ? <p className="orders-empty" role="status">{search || status || procurementStatus || shipmentStatus ? t('orders.noResults') : t('orders.empty')}</p> : <>
      <div className="orders-table-wrap"><table aria-label={t('orders.table')} className="orders-table"><thead><tr><th className="table-row-index" scope="col">{t('orders.number')}</th><th scope="col">{t('orders.product')}</th><th scope="col">{t('orders.customer')}</th><th scope="col">{t('orders.delivery')}</th><th scope="col">{t('orders.shipment')}</th><th scope="col">{t('orders.status')}</th><th scope="col">{t('orders.procurement')}</th><th scope="col">{t('orders.confidence')}</th><th className="orders-date-column" scope="col">{t('orders.date')}</th><th scope="col"><span className="sr-only">{t('orders.actions')}</span></th></tr></thead><tbody>{orders.map((order, index) => <OrderRow href={orderDetailUrl(order.id, returnTo)} key={order.id} order={order} onOpen={(href) => router.push(href)} rowNumber={rowNumber(page, pageSize, index)} />)}</tbody></table></div>
      <div className="orders-cards">{orders.map((order, index) => <OrderCard href={orderDetailUrl(order.id, returnTo)} key={order.id} order={order} rowNumber={rowNumber(page, pageSize, index)} />)}</div>
    </>}
    {total > 0 && <TablePagination ariaLabel={t('orders.pages')} onPageChange={(nextPage) => navigate(nextPage)} onPageSizeChange={(nextPageSize) => navigate(1, nextPageSize)} page={page} pageSize={pageSize} total={total} />}
  </>;
}

function OrderRow({ order, href, onOpen, rowNumber }: { order: ManagerOrder; href: string; onOpen: (href: string) => void; rowNumber: number }) {
  const { t, formatDate, formatNumber } = useI18n();
  return <tr className="orders-table-row" onClick={() => onOpen(href)}><td className="table-row-index">{formatNumber(rowNumber)}</td><td><strong>{productLabel(order, t)}</strong><small>{productMeta(order, t, formatNumber)}</small></td><td><strong>{customerLabel(order, t)}</strong><small>{contactLabel(order, t)}</small></td><td><span className="order-delivery">{deliveryLabel(order, t)}</span></td><td><span className="order-delivery">{shipmentLabel(order, t)}</span></td><td><OrderStatusBadge status={order.status} /></td><td><ProcurementBadge status={order.procurementSummary} /></td><td className="order-confidence">{confidenceLabel(order, formatNumber)}</td><td className="orders-date-column"><time dateTime={order.createdAt}>{dateLabel(order.createdAt, formatDate)}</time></td><td><Link aria-label={viewLabel(order, t)} className="text-button" href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>{t('orders.view')}</Link></td></tr>;
}

function OrderCard({ order, href, rowNumber }: { order: ManagerOrder; href: string; rowNumber: number }) {
  const { t, formatDate, formatNumber } = useI18n();
  return <Link aria-label={viewLabel(order, t)} className="orders-card" href={href}><div className="orders-card-heading"><span><span className="orders-card-index">{t('orders.number')} {formatNumber(rowNumber)}</span><strong>{productLabel(order, t)}</strong><small>{productMeta(order, t, formatNumber)}</small></span><span className="order-confidence">{confidenceLabel(order, formatNumber)}</span></div><dl><div><dt>{t('orders.customer')}</dt><dd>{customerLabel(order, t)}</dd></div><div><dt>{t('orders.delivery')}</dt><dd>{deliveryLabel(order, t)}</dd></div><div><dt>{t('orders.shipment')}</dt><dd>{shipmentLabel(order, t)}</dd></div><div><dt>{t('orders.procurement')}</dt><dd><ProcurementBadge status={order.procurementSummary} /></dd></div><div><dt>{t('orders.date')}</dt><dd>{dateLabel(order.createdAt, formatDate)}</dd></div></dl><div className="orders-card-actions"><OrderStatusBadge status={order.status} /><span className="text-button">{t('orders.view')}</span></div></Link>;
}

function OrderStatusBadge({ status }: { status: OrderStatus }) { const { t } = useI18n(); return <span className={`order-table-status status-${status.toLowerCase()}`}>{statusLabel(status, t)}</span>; }
function ProcurementBadge({ status }: { status: ProcurementSummary }) { const { t } = useI18n(); return <span className={`procurement-badge procurement-${status.toLowerCase()}`}>{procurementLabel(status, t)}</span>; }
function productLabel(order: ManagerOrder, t: Translator) { const labels = order.items.map((item) => item.productName ?? item.originalText).filter(Boolean); return labels.length > 0 ? labels.join(', ') : t('orders.noProducts'); }
function productMeta(order: ManagerOrder, t: Translator, formatNumber: (value: number) => string) { const sku = order.items.map((item) => item.catalogId).filter(Boolean).join(', '); const extra = order.items.length > 1 ? t('orders.itemCount', { count: formatNumber(order.items.length) }) : ''; return [sku || t('orders.noSku'), extra].filter(Boolean).join(' · '); }
function customerLabel(order: ManagerOrder, t: Translator) { return order.customer.name ?? order.participantName ?? t('orders.instagramCustomer'); }
function contactLabel(order: ManagerOrder, t: Translator) { return order.customer.phone ?? (order.customer.instagramUsername ? `@${order.customer.instagramUsername.replace(/^@/, '')}` : t('orders.noContact')); }
function deliveryLabel(order: ManagerOrder, t: Translator) { return [order.delivery.city, order.delivery.novaPoshtaBranch ?? order.delivery.address].filter(Boolean).join(', ') || t('orders.notSpecified'); }
function shipmentLabel(order: ManagerOrder, t: Translator) { if (!order.shipment) return t('orders.shipmentNotCreated'); const status = shipmentStatusLabel(order.shipment.status, t); return order.shipment.trackingNumber ? `${status} · ${order.shipment.trackingNumber}` : status; }
function confidenceLabel(order: ManagerOrder, formatNumber: (value: number) => string) { return `${formatNumber(Math.round((order.overallConfidence ?? 0) * 100))}%`; }
function viewLabel(order: ManagerOrder, t: Translator) { return t('orders.viewLabel', { customer: order.participantName ?? order.customer.name ?? t('orders.instagramCustomer'), product: productLabel(order, t) }); }
function dateLabel(value: string, formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string) { return formatDate(value, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function rowNumber(page: number, pageSize: number, index: number) { return (Math.max(1, page) - 1) * pageSize + index + 1; }
function statusLabel(status: OrderStatus, t: Translator) { return ({ AI_PROCESSING: t('orders.aiProcessing'), AI_FAILED: t('orders.aiFailed'), NEEDS_REVIEW: t('orders.needsReview'), AUTO_APPROVED: t('orders.autoApproved'), APPROVED: t('orders.approved'), CANCELLED: t('orders.cancelled') } satisfies Record<OrderStatus, string>)[status]; }
function procurementLabel(status: ProcurementSummary, t: Translator) { return ({ UNASSESSED: t('orders.unassessed'), READY: t('orders.ready'), PARTIALLY_READY: t('orders.partiallyReady'), NEEDS_ORDER: t('orders.needsOrder'), SENDING: t('orders.sending'), AWAITING_SUPPLIER: t('orders.awaitingSupplier'), BLOCKED: t('orders.blocked'), HANDED_OFF: t('orders.handedOff') } satisfies Record<ProcurementSummary, string>)[status]; }
function shipmentStatusLabel(status: ShipmentStatus, t: Translator) { return ({ DRAFT: t('orders.draft'), CREATING: t('orders.creating'), CREATED: t('orders.created'), ACCEPTED: t('orders.accepted'), IN_TRANSIT: t('orders.inTransit'), DELIVERED: t('orders.delivered'), RETURNING: t('orders.returning'), RETURNED: t('orders.returned'), CANCELLED: t('orders.cancelled'), FAILED: t('orders.failed') } satisfies Record<ShipmentStatus, string>)[status]; }
function ordersUrl(query: string, status: OrderStatus | '', procurementStatus: ProcurementSummary | '', shipmentStatus: ShipmentStatus | '', page: number, pageSize: number) { const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); if (status) params.set('status', status); if (procurementStatus) params.set('procurementStatus', procurementStatus); if (shipmentStatus) params.set('shipmentStatus', shipmentStatus); if (page > 1) params.set('page', String(page)); if (pageSize !== 25) params.set('pageSize', String(pageSize)); const value = params.toString(); return value ? `/orders?${value}` : '/orders'; }
function orderDetailUrl(orderId: string, returnTo: string) { return returnTo === '/orders' ? `/orders/${orderId}` : `/orders/${orderId}?returnTo=${encodeURIComponent(returnTo)}`; }
