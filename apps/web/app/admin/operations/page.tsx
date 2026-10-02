import type { AdminOperationsSummary } from '../../../../../packages/contracts/src/auth';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { AdminOperations } from '../../../src/components/admin-operations';

export const dynamic = 'force-dynamic';

export default async function AdminOperationsPage() {
  const response = await authenticatedApiFetch('/api/admin/operations');
  if (!response.ok) throw new Error('Не вдалося завантажити операційний стан');
  return <AdminOperations summary={await response.json() as AdminOperationsSummary} />;
}
