import type { ManagerOrder, OrderListResponse } from '../../../../packages/contracts/src/orders';
import { authenticatedApiFetch } from '../auth/session';

async function request<T>(path: string): Promise<T> {
  const response = await authenticatedApiFetch(path);
  if (!response.ok) throw new Error(`Order API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const getOrders = () => request<OrderListResponse>('/api/orders');
export const getOrder = (id: string) => request<ManagerOrder>(`/api/orders/${encodeURIComponent(id)}`);
