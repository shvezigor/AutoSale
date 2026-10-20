import type { AdminConversionReport } from '../../../../../packages/contracts/src/conversion-events';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { AdminConversionsReport } from '../../../src/components/admin-conversions-report';

export const dynamic = 'force-dynamic';

export default async function AdminConversionsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await searchParams;
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFrom = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? '') ? params.to! : defaultTo;
  const response = await authenticatedApiFetch(`/api/admin/conversions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  if (!response.ok) throw new Error('Не вдалося завантажити агрегований звіт');
  return <AdminConversionsReport initial={await response.json() as AdminConversionReport} />;
}
