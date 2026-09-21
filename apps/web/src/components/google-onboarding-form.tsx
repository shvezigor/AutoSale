'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { useI18n } from '../i18n/i18n-provider';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, nativeConstraintMessage, type FieldErrors } from './form-validation';

export function GoogleOnboardingForm({ email, suggestedName }: { email: string; suggestedName: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'tenantName'>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const control = event.currentTarget.elements.namedItem('tenantName');
    if (!(control instanceof HTMLInputElement)) return;
    const validationMessage = nativeConstraintMessage(control, t);
    if (validationMessage) {
      setFieldErrors({ tenantName: validationMessage });
      setState('idle');
      focusFirstInvalid(event.currentTarget, ['tenantName']);
      return;
    }
    setFieldErrors({});
    setState('submitting');
    const tenantName = control.value.trim();
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
    <div className="google-identity-summary"><span>{t('authentication.googleAccount')}</span><strong>{suggestedName}</strong><small>{email}</small></div>
    <form className="auth-form" noValidate onSubmit={(event) => void submit(event)}>
      <FormField className="auth-field" id="google-tenant-name" label={t('authentication.businessName')} error={fieldErrors.tenantName} required>
        <input autoComplete="organization" maxLength={120} minLength={2} name="tenantName" onChange={() => setFieldErrors((current) => clearFieldError(current, 'tenantName'))} />
      </FormField>
      {state === 'error' && <p className="auth-error" role="alert">{t('authentication.onboardingError')}</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? t('authentication.creating') : t('authentication.createWorkspace')}</button>
      {state === 'error' && <Link className="auth-link" href="/login">{t('authentication.startAgain')}</Link>}
    </form>
  </>;
}
