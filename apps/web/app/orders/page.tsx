import Link from 'next/link';
import { getOrders } from '../../src/api/orders';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const { items } = await getOrders();
  return <main className="orders-layout"><OrdersNav /><section className="orders-content"><header className="orders-header"><h1>Замовлення</h1><p>Перевіряйте замовлення, які сформував AI.</p></header><div className="orders-list">{items.length === 0 ? <p className="orders-empty">Замовлень поки немає.</p> : items.map((order) => <Link className="order-row" href={`/orders/${order.id}`} key={order.id}><span><strong>{order.participantName ?? 'Клієнт Instagram'}</strong><small>{order.items.map((item) => item.productName ?? item.originalText).join(', ') || 'Без товарів'}</small></span><span><b>{Math.round((order.overallConfidence ?? 0) * 100)}%</b><small>{order.status === 'NEEDS_REVIEW' ? 'Потребує перевірки' : order.status}</small></span></Link>)}</div></section></main>;
}

export function OrdersNav() { return <aside className="primary-nav"><Link className="brand" href="/conversations">AutoSale</Link><nav aria-label="Головна навігація"><Link className="nav-item" href="/conversations">Діалоги</Link><Link className="nav-item active" href="/orders">Замовлення</Link><Link className="nav-item" href="/settings">Налаштування</Link></nav></aside>; }
