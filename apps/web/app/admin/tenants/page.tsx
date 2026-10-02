import type { AdminTenantSummary } from '../../../../../packages/contracts/src/auth';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { AdminTenantsTable } from '../../../src/components/admin-tenants-table';

export const dynamic = 'force-dynamic';

export default async function AdminTenantsPage() {
  const response = await authenticatedApiFetch('/api/admin/tenants');
  if (!response.ok) throw new Error('Не вдалося завантажити клієнтів');
  return <AdminTenantsTable tenants={await response.json() as AdminTenantSummary[]} />;
}
