import Link from 'next/link';
import { AuthFrame } from '../../../src/components/auth-form';
import { resolveServerLocale } from '../../../src/i18n/server';
import { createTranslator } from '../../../src/i18n/translator';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const t = createTranslator(await resolveServerLocale());
  const token = (await searchParams).token;
  let verified = false;
  if (token) {
    try {
      const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' });
      verified = response.ok;
    } catch { verified = false; }
  }
  return <AuthFrame title={verified ? t('authentication.emailVerified') : t('authentication.emailVerificationFailed')} description={verified ? t('authentication.workspaceActivated') : t('authentication.resetInvalid')}><Link className="primary-button button-link" href="/login">{t('authentication.goToLogin')}</Link></AuthFrame>;
}
