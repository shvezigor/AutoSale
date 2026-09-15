'use client';

import { useState } from 'react';
import { useI18n } from '../i18n/i18n-provider';

export function GoogleSignInButton({ returnPath }: { returnPath?: string | undefined }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function start() {
    setState('loading');
    try {
      const response = await fetch('/api/auth/google/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(returnPath ? { returnPath } : {}),
      });
      const payload = await response.json() as { authorizationUrl?: string };
      const authorizationUrl = payload.authorizationUrl ? new URL(payload.authorizationUrl) : null;
      if (!response.ok || !authorizationUrl || authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'accounts.google.com') {
        throw new Error('Invalid authorization response');
      }
      window.location.assign(authorizationUrl.toString());
    } catch {
      setState('error');
    }
  }

  return <div className="google-sign-in">
    <button className="google-button" disabled={state === 'loading'} onClick={() => void start()} type="button">
      <span aria-hidden="true" className="google-mark">G</span>
      {state === 'loading' ? t('authentication.googleLoading') : t('authentication.googleContinue')}
    </button>
    {state === 'error' && <p className="auth-error" role="alert">{t('authentication.googleError')}</p>}
    <div className="auth-separator"><span>{t('authentication.or')}</span></div>
  </div>;
}
