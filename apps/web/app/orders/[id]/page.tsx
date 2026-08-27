import Link from 'next/link';
import { getOrder, getOrders } from '../../../src/api/orders';
import { getServerSession } from '../../../src/auth/session';
import { OrderReviewPanel } from '../../../src/components/order-review-panel';
import { PrimaryNavigation } from '../../../src/components/primary-navigation';

export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, list, session] = await Promise.all([getOrder(id), getOrders(), getServerSession()]);
  if (!session) return null;
  return <main className="order-detail-layout"><PrimaryNavigation active="orders" session={session} /><section className="orders-rail"><h1>Замовлення</h1>{list.items.map((item) => <Link className="order-row" data-selected={item.id === id} href={`/orders/${item.id}`} key={item.id}><span><strong>{item.participantName ?? 'Клієнт Instagram'}</strong><small>{item.items[0]?.productName ?? item.items[0]?.originalText ?? 'Без товарів'}</small></span><b>{Math.round((item.overallConfidence ?? 0) * 100)}%</b></Link>)}</section><OrderReviewPanel initialOrder={order} /></main>;
}
