'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';

export function GoogleOnboardingForm({ email, suggestedName }: { email: string; suggestedName: string }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    const tenantName = String(new FormData(event.currentTarget).get('tenantName')).trim();
    if (tenantName.length < 2 || tenantName.length > 120) {
      setState('error');
      return;
    }
    try {
      const response = await fetch('/api/auth/google/onboarding', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantName }),
      });
      if (!response.ok) throw new Error('Onboarding failed');
      window.location.assign('/conversations');
    } catch {
      setState('error');
    }
  }

  return <>
    <div className="google-identity-summary"><span>Google-акаунт</span><strong>{suggestedName}</strong><small>{email}</small></div>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label className="auth-field"><span>Назва бізнесу</span><input autoComplete="organization" maxLength={120} minLength={2} name="tenantName" required /></label>
      {state === 'error' && <p className="auth-error" role="alert">Не вдалося створити робочий простір. Почніть вхід ще раз.</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? 'Створюємо…' : 'Створити робочий простір'}</button>
      {state === 'error' && <Link className="auth-link" href="/login">Почати знову</Link>}
    </form>
  </>;
}
