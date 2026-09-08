'use client';

import type { ManagerOrder, OrderStatus } from '../../../../packages/contracts/src/orders';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, MouseEvent, useState } from 'react';

import { TablePagination } from './table-pagination';

type OrdersTableProps = { orders: ManagerOrder[]; page: number; pageSize: number; total: number; search?: string; status?: OrderStatus };

const statuses: Array<{ value: OrderStatus | ''; label: string }> = [
  { value: '', label: 'Усі статуси' },
  { value: 'NEEDS_REVIEW', label: 'Потребує перевірки' },
  { value: 'AUTO_APPROVED', label: 'Автопідтверджено' },
  { value: 'APPROVED', label: 'Підтверджено' },
  { value: 'AI_PROCESSING', label: 'AI обробляє' },
  { value: 'AI_FAILED', label: 'Помилка AI' },
  { value: 'CANCELLED', label: 'Скасовано' },
];

export function OrdersTable({ orders, page, pageSize, total, search = '', status }: OrdersTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState(search);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | ''>(status ?? '');
  const navigate = (nextPage: number, nextPageSize = pageSize, nextStatus = selectedStatus) => router.replace(ordersUrl(query, nextStatus, nextPage, nextPageSize), { scroll: false });
  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); navigate(1); };
  const changeStatus = (value: OrderStatus | '') => { setSelectedStatus(value); navigate(1, pageSize, value); };

  return <>
    <div className="orders-toolbar">
      <form onSubmit={submitSearch} role="search"><label className="sr-only" htmlFor="orders-search">Пошук замовлень</label><input id="orders-search" onChange={(event) => setQuery(event.target.value)} placeholder="Клієнт, товар або артикул" type="search" value={query} /><button className="secondary-button" type="submit">Знайти</button></form>
      <label className="orders-status-filter"><span className="sr-only">Статус замовлення</span><select aria-label="Статус замовлення" onChange={(event) => changeStatus(event.target.value as OrderStatus | '')} value={selectedStatus}>{statuses.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}</select></label>
    </div>
    {orders.length === 0 ? <p className="orders-empty" role="status">{search || status ? 'Замовлень за цим запитом не знайдено.' : 'Замовлень поки немає.'}</p> : <>
      <div className="orders-table-wrap"><table aria-label="Замовлення" className="orders-table"><thead><tr><th scope="col">Товар</th><th scope="col">Клієнт</th><th scope="col">Доставка</th><th scope="col">Статус</th><th scope="col">Впевненість</th><th scope="col">Дата</th><th scope="col"><span className="sr-only">Дії</span></th></tr></thead><tbody>{orders.map((order) => <OrderRow key={order.id} order={order} onOpen={() => router.push(`/orders/${order.id}`)} />)}</tbody></table></div>
      <div className="orders-cards">{orders.map((order) => <OrderCard key={order.id} order={order} />)}</div>
    </>}
    {total > 0 && <TablePagination ariaLabel="Сторінки замовлень" onPageChange={(nextPage) => navigate(nextPage)} onPageSizeChange={(nextPageSize) => navigate(1, nextPageSize)} page={page} pageSize={pageSize} total={total} />}
  </>;
}

function OrderRow({ order, onOpen }: { order: ManagerOrder; onOpen: () => void }) {
  const href = `/orders/${order.id}`;
  return <tr className="orders-table-row" onClick={onOpen}><td><strong>{productLabel(order)}</strong><small>{productMeta(order)}</small></td><td><strong>{customerLabel(order)}</strong><small>{contactLabel(order)}</small></td><td><span className="order-delivery">{deliveryLabel(order)}</span></td><td><OrderStatusBadge status={order.status} /></td><td className="order-confidence">{confidenceLabel(order)}</td><td><time dateTime={order.createdAt}>{dateLabel(order.createdAt)}</time></td><td><Link aria-label={viewLabel(order)} className="text-button" href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}>Переглянути</Link></td></tr>;
}

function OrderCard({ order }: { order: ManagerOrder }) {
  return <Link aria-label={viewLabel(order)} className="orders-card" href={`/orders/${order.id}`}><div className="orders-card-heading"><span><strong>{productLabel(order)}</strong><small>{productMeta(order)}</small></span><span className="order-confidence">{confidenceLabel(order)}</span></div><dl><div><dt>Клієнт</dt><dd>{customerLabel(order)}</dd></div><div><dt>Доставка</dt><dd>{deliveryLabel(order)}</dd></div><div><dt>Дата</dt><dd>{dateLabel(order.createdAt)}</dd></div></dl><div className="orders-card-actions"><OrderStatusBadge status={order.status} /><span className="text-button">Переглянути</span></div></Link>;
}

function OrderStatusBadge({ status }: { status: OrderStatus }) { return <span className={`order-table-status status-${status.toLowerCase()}`}>{statusLabel(status)}</span>; }
function productLabel(order: ManagerOrder) { const labels = order.items.map((item) => item.productName ?? item.originalText).filter(Boolean); return labels.length > 0 ? labels.join(', ') : 'Без товарів'; }
function productMeta(order: ManagerOrder) { const sku = order.items.map((item) => item.catalogId).filter(Boolean).join(', '); const extra = order.items.length > 1 ? `${order.items.length} позиції` : ''; return [sku || 'Без артикулу', extra].filter(Boolean).join(' · '); }
function customerLabel(order: ManagerOrder) { return order.customer.name ?? order.participantName ?? 'Клієнт Instagram'; }
function contactLabel(order: ManagerOrder) { return order.customer.phone ?? (order.customer.instagramUsername ? `@${order.customer.instagramUsername.replace(/^@/, '')}` : 'Контакт не вказано'); }
function deliveryLabel(order: ManagerOrder) { return [order.delivery.city, order.delivery.novaPoshtaBranch ?? order.delivery.address].filter(Boolean).join(', ') || 'Не вказано'; }
function confidenceLabel(order: ManagerOrder) { return `${Math.round((order.overallConfidence ?? 0) * 100)}%`; }
function viewLabel(order: ManagerOrder) { return `Переглянути замовлення ${order.participantName ?? order.customer.name ?? 'клієнта'}: ${productLabel(order)}`; }
function dateLabel(value: string) { return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value)); }
function statusLabel(status: OrderStatus) { return ({ AI_PROCESSING: 'AI обробляє', AI_FAILED: 'Помилка AI', NEEDS_REVIEW: 'Потребує перевірки', AUTO_APPROVED: 'Автопідтверджено', APPROVED: 'Підтверджено', CANCELLED: 'Скасовано' } satisfies Record<OrderStatus, string>)[status]; }
function ordersUrl(query: string, status: OrderStatus | '', page: number, pageSize: number) { const params = new URLSearchParams(); if (query.trim()) params.set('search', query.trim()); if (status) params.set('status', status); if (page > 1) params.set('page', String(page)); if (pageSize !== 25) params.set('pageSize', String(pageSize)); const value = params.toString(); return value ? `/orders?${value}` : '/orders'; }
