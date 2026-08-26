import type { ManagerOrder, OrderListResponse } from '../../../../packages/contracts/src/orders';

async function request<T>(path: string): Promise<T> {
  const baseUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const response = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Order API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const getOrders = () => request<OrderListResponse>('/api/orders');
export const getOrder = (id: string) => request<ManagerOrder>(`/api/orders/${encodeURIComponent(id)}`);
