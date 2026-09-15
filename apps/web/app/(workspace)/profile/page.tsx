import type { ProfileResponse } from '../../../../../packages/contracts/src/profile';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { LocaleSwitcher } from '../../../src/components/locale-switcher';
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
    <section className="profile-card profile-language-card" aria-labelledby="profile-language-heading">
      <div><h2 id="profile-language-heading">Мова інтерфейсу</h2><p>Оберіть мову меню, сторінок і системних повідомлень.</p></div>
      <LocaleSwitcher variant="profile" />
    </section>
    <ProfileEditor initial={profile} />
  </main>;
}
