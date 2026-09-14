import type { ProfileResponse } from '../../../../../packages/contracts/src/profile';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { ProfileEditor } from '../../../src/components/profile-editor';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const response = await authenticatedApiFetch('/api/profile');
  if (!response.ok) throw new Error('Не вдалося завантажити профіль');
  const profile = await response.json() as ProfileResponse;

  return <main className="profile-layout-content">
    <header className="profile-page-header">
      <h1>Мій профіль</h1>
      <p>Керуйте особистими даними, фото та безпекою свого акаунта.</p>
    </header>
    <ProfileEditor initial={profile} />
  </main>;
}
