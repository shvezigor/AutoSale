import Link from 'next/link';
import { AuthFrame } from '../../../src/components/auth-form';

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token;
  let verified = false;
  if (token) {
    try {
      const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/verify-email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store' });
      verified = response.ok;
    } catch { verified = false; }
  }
  return <AuthFrame title={verified ? 'Email підтверджено' : 'Не вдалося підтвердити email'} description={verified ? 'Ваш робочий простір активовано.' : 'Посилання недійсне або протерміноване.'}><Link className="primary-button button-link" href="/login">Перейти до входу</Link></AuthFrame>;
}
