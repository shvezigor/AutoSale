import type { AdminTenantSummary } from '../../../../packages/contracts/src/auth';
import { authenticatedApiFetch } from '../../src/auth/session';
import { AdminDashboard } from '../../src/components/admin-dashboard';

export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const [tenantsResponse, healthResponse] = await Promise.all([authenticatedApiFetch('/api/admin/tenants'), authenticatedApiFetch('/api/admin/health-summary')]);
  if (!tenantsResponse.ok || !healthResponse.ok) throw new Error('Не вдалося завантажити стан платформи');
  return <AdminDashboard tenants={await tenantsResponse.json() as AdminTenantSummary[]} health={await healthResponse.json() as { status: 'ok' }} />;
}
