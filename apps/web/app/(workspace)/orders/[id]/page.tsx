import Link from 'next/link';
import { getOrder, getOrders } from '../../../../src/api/orders';
import { OrderReviewPanel } from '../../../../src/components/order-review-panel';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params, searchParams = Promise.resolve({}) }: { params: Promise<{ id: string }>; searchParams?: Promise<{ returnTo?: string | string[] }> }) {
  const { id } = await params;
  const query = await searchParams;
  const backHref = safeOrdersReturn(query.returnTo);
  const [order, list] = await Promise.all([getOrder(id), getOrders()]);
  return <main className="order-detail-layout order-detail-layout-content"><section className="orders-rail"><h1>Замовлення</h1>{list.items.map((item) => <Link className="order-row" data-selected={item.id === id} href={detailHref(item.id, backHref)} key={item.id}><span><strong>{item.participantName ?? 'Клієнт Instagram'}</strong><small>{item.items[0]?.productName ?? item.items[0]?.originalText ?? 'Без товарів'}</small></span><b>{Math.round((item.overallConfidence ?? 0) * 100)}%</b></Link>)}</section><OrderReviewPanel backHref={backHref} initialOrder={order} /></main>;
}

function safeOrdersReturn(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.length <= 1_000 && (candidate === '/orders' || candidate.startsWith('/orders?')) ? candidate : '/orders';
}

function detailHref(orderId: string, backHref: string): string {
  return backHref === '/orders' ? `/orders/${orderId}` : `/orders/${orderId}?returnTo=${encodeURIComponent(backHref)}`;
}
