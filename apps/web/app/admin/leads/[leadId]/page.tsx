import type { AdminDemoLeadDetail as AdminDemoLeadDetailData } from '../../../../../../packages/contracts/src/admin-demo-leads';
import { notFound } from 'next/navigation';

import { authenticatedApiFetch } from '../../../../src/auth/session';
import { AdminDemoLeadDetail } from '../../../../src/components/admin-demo-lead-detail';

export const dynamic = 'force-dynamic';

export default async function AdminDemoLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const response = await authenticatedApiFetch(`/api/admin/demo-leads/${encodeURIComponent(leadId)}`);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Не вдалося завантажити демозаявку');
  return <AdminDemoLeadDetail lead={await response.json() as AdminDemoLeadDetailData} />;
}
