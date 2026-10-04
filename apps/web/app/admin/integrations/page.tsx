import { adminIntegrationListSchema } from '../../../../../packages/contracts/src/auth';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { AdminIntegrations } from '../../../src/components/admin-integrations';

export const dynamic = 'force-dynamic';

export default async function AdminIntegrationsPage() {
  const response = await authenticatedApiFetch('/api/admin/integrations');
  if (!response.ok) throw new Error('Не вдалося завантажити інтеграції');
  const parsed = adminIntegrationListSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('Отримано некоректний стан інтеграцій');
  return <AdminIntegrations initialControls={parsed.data} />;
}
