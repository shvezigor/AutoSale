import { authenticatedApiFetch } from '../../../src/auth/session';
import { TeamManagement, type TeamData } from '../../../src/components/team-management';

export const dynamic = 'force-dynamic';
export default async function TeamPage() {
  const response = await authenticatedApiFetch('/api/team');
  if (!response.ok) throw new Error('Не вдалося завантажити команду');
  return <main className="settings-layout-content"><TeamManagement initial={await response.json() as TeamData} /></main>;
}
