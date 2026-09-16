import type { ManagerOrder, OrderListResponse, OrderStatus } from '../../../../packages/contracts/src/orders';
import type { ProcurementSummary } from '../../../../packages/contracts/src/procurement';
import type { ShipmentStatus } from '../../../../packages/contracts/src/delivery';
import { authenticatedApiFetch } from '../auth/session';

async function request<T>(path: string): Promise<T> {
  const response = await authenticatedApiFetch(path);
  if (!response.ok) throw new Error(`Order API returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const getOrders = (query: { search?: string; status?: OrderStatus; procurementStatus?: ProcurementSummary; shipmentStatus?: ShipmentStatus; page?: number; pageSize?: number; sort?: 'product' | 'customer' | 'status' | 'procurement' | 'confidence' | 'date'; direction?: 'asc' | 'desc' } = {}) => {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.procurementStatus) params.set('procurementStatus', query.procurementStatus);
  if (query.shipmentStatus) params.set('shipmentStatus', query.shipmentStatus);
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  const suffix = params.toString();
  return request<OrderListResponse>(suffix ? `/api/orders?${suffix}` : '/api/orders');
};
export const getOrder = (id: string) => request<ManagerOrder>(`/api/orders/${encodeURIComponent(id)}`);
