import type { ProfileResponse } from '../../../../../packages/contracts/src/profile';

import { authenticatedApiFetch } from '../../../src/auth/session';
import { LocaleSwitcher } from '../../../src/components/locale-switcher';
import { ProfileEditor } from '../../../src/components/profile-editor';
import { createTranslator } from '../../../src/i18n/translator';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const response = await authenticatedApiFetch('/api/profile');
  if (!response.ok) throw new Error('Не вдалося завантажити профіль');
  const profile = await response.json() as ProfileResponse;
  const t = createTranslator(profile.locale);

  return <main className="profile-layout-content">
    <header className="profile-page-header">
      <h1>{t('profile.pageTitle')}</h1>
      <p>{t('profile.pageDescription')}</p>
    </header>
    <section className="profile-card profile-language-card" aria-labelledby="profile-language-heading">
      <div><h2 id="profile-language-heading">{t('language.label')}</h2><p>{t('profile.languageDescription')}</p></div>
      <LocaleSwitcher variant="profile" />
    </section>
    <ProfileEditor initial={profile} />
  </main>;
}
