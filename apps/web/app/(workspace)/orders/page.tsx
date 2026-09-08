import { getOrders } from '../../../src/api/orders';
import { OrdersTable } from '../../../src/components/orders-table';
import type { OrderStatus } from '../../../../../packages/contracts/src/orders';

export const dynamic = 'force-dynamic';

type OrdersPageProps = { searchParams: Promise<{ page?: string | string[]; pageSize?: string | string[]; search?: string | string[]; status?: string | string[] }> };

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const params = await searchParams;
  const page = positiveInteger(params.page) ?? 1;
  const pageSize = allowedPageSize(params.pageSize);
  const search = textParam(params.search);
  const status = statusParam(params.status);
  const orders = await getOrders({ page, pageSize, ...(search ? { search } : {}), ...(status ? { status } : {}) });
  return <main className="orders-layout orders-layout-content"><section className="orders-content"><header className="orders-header"><h1>Замовлення</h1><p>Перевіряйте замовлення, які сформував AI.</p></header><OrdersTable orders={orders.items} page={orders.page} pageSize={orders.pageSize} search={search} {...(status ? { status } : {})} total={orders.total} /></section></main>;
}

function positiveInteger(value: string | string[] | undefined) { const parsed = Number(Array.isArray(value) ? value[0] : value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function allowedPageSize(value: string | string[] | undefined) { const parsed = positiveInteger(value); return parsed && [10, 25, 50, 100].includes(parsed) ? parsed : 25; }
function textParam(value: string | string[] | undefined) { return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) ?? ''; }
function statusParam(value: string | string[] | undefined): OrderStatus | undefined { const candidate = Array.isArray(value) ? value[0] : value; return candidate && ['AI_PROCESSING', 'AI_FAILED', 'NEEDS_REVIEW', 'AUTO_APPROVED', 'APPROVED', 'CANCELLED'].includes(candidate) ? candidate as OrderStatus : undefined; }
