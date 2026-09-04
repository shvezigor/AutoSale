import { authenticatedApiFetch, getServerSession } from '../../src/auth/session';
import { AuthenticatedShell } from '../../src/components/authenticated-shell';
import { TeamManagement, type TeamData } from '../../src/components/team-management';

export const dynamic = 'force-dynamic';
export default async function TeamPage() {
  const [response, session] = await Promise.all([authenticatedApiFetch('/api/team'), getServerSession()]);
  if (!session) return null;
  if (!response.ok) throw new Error('Не вдалося завантажити команду');
  return <AuthenticatedShell active="team" session={session}><main className="settings-layout-content"><TeamManagement initial={await response.json() as TeamData} /></main></AuthenticatedShell>;
}
