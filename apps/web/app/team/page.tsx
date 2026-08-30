import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { PrimaryNavigation } from '../../src/components/primary-navigation';
import { TeamManagement, type TeamData } from '../../src/components/team-management';

export const dynamic = 'force-dynamic';
export default async function TeamPage() {
  const [response, session] = await Promise.all([authenticatedApiFetch('/api/team'), getServerSession()]);
  if (!session) return null;
  if (!response.ok) throw new Error('Не вдалося завантажити команду');
  return <main className="settings-layout"><PrimaryNavigation active="team" session={session} /><TeamManagement initial={await response.json() as TeamData} /></main>;
}
