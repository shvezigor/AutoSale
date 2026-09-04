import { cookies } from 'next/headers';
import Link from 'next/link';

import { AuthFrame } from '../../../../src/components/auth-form';
import { GoogleOnboardingForm } from '../../../../src/components/google-onboarding-form';

export const dynamic = 'force-dynamic';

export default async function GoogleOnboardingPage() {
  const cookieStore = await cookies();
  let identity: { email: string; name: string } | null = null;
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/google/onboarding`, {
      headers: { cookie: cookieStore.toString() }, cache: 'no-store',
    });
    if (response.ok) identity = await response.json() as { email: string; name: string };
  } catch {}

  if (!identity) return <AuthFrame title="Посилання протерміновано" description="Сеанс реєстрації через Google більше недоступний.">
    <Link className="primary-button button-link" href="/login">Почати знову</Link>
  </AuthFrame>;

  return <AuthFrame title="Створіть робочий простір" description="Google-акаунт підтверджено. Залишилося вказати назву бізнесу.">
    <GoogleOnboardingForm email={identity.email} suggestedName={identity.name} />
  </AuthFrame>;
}
