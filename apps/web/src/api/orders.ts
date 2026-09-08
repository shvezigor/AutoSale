import type { ManagerOrder, OrderListResponse, OrderStatus } from '../../../../packages/contracts/src/orders';
import { authenticatedApiFetch } from '../auth/session';

async function request<T>(path: string): Promise<T> {
  const response = await authenticatedApiFetch(path);
  if (!response.ok) throw new Error(`Order API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const getOrders = (query: { search?: string; status?: OrderStatus; page?: number; pageSize?: number } = {}) => {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const suffix = params.toString();
  return request<OrderListResponse>(suffix ? `/api/orders?${suffix}` : '/api/orders');
};
export const getOrder = (id: string) => request<ManagerOrder>(`/api/orders/${encodeURIComponent(id)}`);
