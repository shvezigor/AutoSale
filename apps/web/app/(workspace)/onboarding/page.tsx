import Link from 'next/link';

import { getServerSession } from '../../../src/auth/session';
import { createTranslator } from '../../../src/i18n/translator';

export default async function OnboardingPage() {
  const session = await getServerSession();
  const t = createTranslator(session?.locale ?? 'uk');
  const steps = [t('onboarding.steps.channel'), t('onboarding.steps.catalogue'), t('onboarding.steps.delivery')];

  return <main className="onboarding-page">
    <section className="onboarding-card">
      <span className="onboarding-status">{t('onboarding.status')}</span>
      <div className="onboarding-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg></div>
      <h1>{t('onboarding.title')}</h1>
      <p>{t('onboarding.description')}</p>
      <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
      <Link href="/settings">{t('onboarding.settings')}</Link>
    </section>
  </main>;
}
