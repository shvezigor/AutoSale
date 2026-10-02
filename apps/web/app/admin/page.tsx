import type { AdminOperationsSummary, AdminPlatformOverview } from '../../../../packages/contracts/src/auth';
import { authenticatedApiFetch } from '../../src/auth/session';
import { AdminDashboard } from '../../src/components/admin-dashboard';

export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const [overviewResponse, operationsResponse] = await Promise.all([
    authenticatedApiFetch('/api/admin/overview'),
    authenticatedApiFetch('/api/admin/operations'),
  ]);
  if (!overviewResponse.ok || !operationsResponse.ok) throw new Error('Не вдалося завантажити стан платформи');
  return <AdminDashboard
    overview={await overviewResponse.json() as AdminPlatformOverview}
    operations={await operationsResponse.json() as AdminOperationsSummary}
  />;
}
