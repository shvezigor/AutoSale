import Link from 'next/link';
import { getOrders } from '../../src/api/orders';
import { getServerSession } from '../../src/auth/session';
import { PrimaryNavigation } from '../../src/components/primary-navigation';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const [{ items }, session] = await Promise.all([getOrders(), getServerSession()]);
  if (!session) return null;
  return <main className="orders-layout"><PrimaryNavigation active="orders" session={session} /><section className="orders-content"><header className="orders-header"><h1>Замовлення</h1><p>Перевіряйте замовлення, які сформував AI.</p></header><div className="orders-list">{items.length === 0 ? <p className="orders-empty">Замовлень поки немає.</p> : items.map((order) => <Link className="order-row" href={`/orders/${order.id}`} key={order.id}><span><strong>{order.participantName ?? 'Клієнт Instagram'}</strong><small>{order.items.map((item) => item.productName ?? item.originalText).join(', ') || 'Без товарів'}</small></span><span><b>{Math.round((order.overallConfidence ?? 0) * 100)}%</b><small>{order.status === 'NEEDS_REVIEW' ? 'Потребує перевірки' : order.status}</small></span></Link>)}</div></section></main>;
}
