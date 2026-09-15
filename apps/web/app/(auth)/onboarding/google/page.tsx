import { cookies } from 'next/headers';
import Link from 'next/link';

import { AuthFrame } from '../../../../src/components/auth-form';
import { GoogleOnboardingForm } from '../../../../src/components/google-onboarding-form';
import { resolveServerLocale } from '../../../../src/i18n/server';
import { createTranslator } from '../../../../src/i18n/translator';

export const dynamic = 'force-dynamic';

export default async function GoogleOnboardingPage() {
  const t = createTranslator(await resolveServerLocale());
  const cookieStore = await cookies();
  let identity: { email: string; name: string } | null = null;
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/google/onboarding`, {
      headers: { cookie: cookieStore.toString() }, cache: 'no-store',
    });
    if (response.ok) identity = await response.json() as { email: string; name: string };
  } catch {}

  if (!identity) return <AuthFrame title={t('authentication.expiredTitle')} description={t('authentication.expiredDescription')}>
    <Link className="primary-button button-link" href="/login">{t('authentication.startAgain')}</Link>
  </AuthFrame>;

  return <AuthFrame title={t('authentication.registerTitle')} description={t('authentication.googleConfirmed')}>
    <GoogleOnboardingForm email={identity.email} suggestedName={identity.name} />
  </AuthFrame>;
}
