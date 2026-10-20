import type { AdminDemoLeadList, AdminDemoLeadStatus } from '../../../../../packages/contracts/src/admin-demo-leads';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { AdminDemoLeadsTable } from '../../../src/components/admin-demo-leads-table';

export const dynamic = 'force-dynamic';

export default async function AdminDemoLeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: rawStatus } = await searchParams;
  const status: 'ALL' | AdminDemoLeadStatus = rawStatus && ['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED'].includes(rawStatus)
    ? rawStatus as AdminDemoLeadStatus : 'ALL';
  const query = status === 'ALL' ? '' : `?status=${status}`;
  const response = await authenticatedApiFetch(`/api/admin/demo-leads${query}`);
  if (!response.ok) throw new Error('Не вдалося завантажити демозаявки');
  return <AdminDemoLeadsTable key={status} initial={await response.json() as AdminDemoLeadList} status={status} />;
}
