import type { AdminTenantSummary } from '../../../../../../packages/contracts/src/auth';
import { notFound } from 'next/navigation';

import { authenticatedApiFetch } from '../../../../src/auth/session';
import { AdminTenantDetail } from '../../../../src/components/admin-tenant-detail';

export const dynamic = 'force-dynamic';

export default async function AdminTenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const response = await authenticatedApiFetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Не вдалося завантажити клієнта');
  return <AdminTenantDetail tenant={await response.json() as AdminTenantSummary} />;
}
