import { dashboardResponseSchema, type DashboardPeriod, type DashboardResponse } from '../../../../packages/contracts/src/dashboard';
import { authenticatedApiFetch } from '../auth/session';

export async function getDashboard(period: DashboardPeriod): Promise<DashboardResponse> {
  const response = await authenticatedApiFetch(`/api/dashboard?period=${period}`);
  if (!response.ok) throw new Error(`Dashboard API returned HTTP ${response.status}`);
  return dashboardResponseSchema.parse(await response.json());
}
