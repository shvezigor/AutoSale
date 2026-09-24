'use client';

import Link from 'next/link';
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useState } from 'react';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, nativeConstraintMessage, type FieldErrors } from './form-validation';
import { GoogleSignInButton } from './google-sign-in-button';

type SubmitResult = { ok: boolean; previewUrl?: string };

export function AuthLoadingState() {
  const { t } = useI18n();
  return <main className="route-state">{t('common.loading')}</main>;
}

export function LoginForm({ submit, googleReturnPath }: { submit: (input: { email: string; password: string }) => Promise<SubmitResult>; googleReturnPath?: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email' | 'password'>>({});
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateFields(event.currentTarget, ['email', 'password'], t);
    setFieldErrors(errors);
    setState('idle');
    if (Object.keys(errors).length > 0) return;
    setState('submitting');
    const data = new FormData(event.currentTarget);
    const result = await submit({ email: String(data.get('email')), password: String(data.get('password')) });
    setState(result.ok ? 'idle' : 'error');
  }
  return <AuthFrame title={t('authentication.loginTitle')} description={t('authentication.loginDescription')}>
    <GoogleSignInButton returnPath={googleReturnPath} />
    <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
      <Field label={t('authentication.email')} name="email" type="email" autoComplete="email" error={fieldErrors.email} onClear={() => setFieldErrors((current) => clearFieldError(current, 'email'))} />
      <Field label={t('authentication.password')} name="password" type="password" autoComplete="current-password" minLength={12} error={fieldErrors.password} onClear={() => setFieldErrors((current) => clearFieldError(current, 'password'))} />
      {state === 'error' && <p className="auth-error" role="alert">{t('authentication.loginError')}</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? t('authentication.loggingIn') : t('authentication.login')}</button>
      <Link className="auth-link" href="/forgot-password">{t('authentication.forgotPassword')}</Link>
    </form>
    <p className="auth-switch">{t('authentication.noAccount')} <Link href="/register">{t('authentication.register')}</Link></p>
  </AuthFrame>;
}

export function RegisterForm({ submit }: { submit: (input: { name: string; tenantName: string; email: string; password: string }) => Promise<SubmitResult> }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'name' | 'tenantName' | 'email' | 'password'>>({});
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateFields(event.currentTarget, ['name', 'tenantName', 'email', 'password'], t);
    setFieldErrors(errors);
    setState('idle');
    if (Object.keys(errors).length > 0) return;
    setState('submitting');
    const data = new FormData(event.currentTarget);
    const result = await submit({ name: String(data.get('name')), tenantName: String(data.get('tenantName')), email: String(data.get('email')), password: String(data.get('password')) });
    setPreviewUrl(result.previewUrl);
    setState(result.ok ? 'success' : 'error');
  }
  if (state === 'success') return <AuthFrame title={t('authentication.verifyEmailTitle')} description={t('authentication.verifyEmailDescription')}>{previewUrl && <Link className="primary-button button-link" data-testid="dev-verification-link" href={previewUrl}>{t('authentication.activateTest')}</Link>}<Link className="auth-link" href="/login">{t('authentication.goToLogin')}</Link></AuthFrame>;
  return <AuthFrame title={t('authentication.registerTitle')} description={t('authentication.registerDescription')}>
    <GoogleSignInButton />
    <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}>
      <Field label={t('authentication.name')} name="name" autoComplete="name" maxLength={120} error={fieldErrors.name} onClear={() => setFieldErrors((current) => clearFieldError(current, 'name'))} />
      <Field label={t('authentication.organization')} name="tenantName" autoComplete="organization" maxLength={160} error={fieldErrors.tenantName} onClear={() => setFieldErrors((current) => clearFieldError(current, 'tenantName'))} />
      <Field label={t('authentication.email')} name="email" type="email" autoComplete="email" error={fieldErrors.email} onClear={() => setFieldErrors((current) => clearFieldError(current, 'email'))} />
      <Field label={t('authentication.password')} name="password" type="password" autoComplete="new-password" minLength={12} hint={t('authentication.passwordHint')} error={fieldErrors.password} onClear={() => setFieldErrors((current) => clearFieldError(current, 'password'))} />
      {state === 'error' && <p className="auth-error" role="alert">{t('authentication.registerError')}</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? t('authentication.creating') : t('authentication.register')}</button>
    </form>
    <p className="auth-switch">{t('authentication.hasAccount')} <Link href="/login">{t('authentication.login')}</Link></p>
  </AuthFrame>;
}

export function ForgotPasswordForm({ submit }: { submit: (input: { email: string }) => Promise<SubmitResult> }) {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'email'>>({});
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const errors = validateFields(event.currentTarget, ['email'], t); setFieldErrors(errors); if (Object.keys(errors).length > 0) return; const data = new FormData(event.currentTarget); await submit({ email: String(data.get('email')) }); setSent(true); }
  return <AuthFrame title={t('authentication.recoveryTitle')} description={t('authentication.recoveryDescription')}>{sent ? <><p className="auth-success">{t('authentication.recoverySent')}</p><Link className="auth-link" href="/login">{t('authentication.backToLogin')}</Link></> : <form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}><Field label={t('authentication.email')} name="email" type="email" autoComplete="email" error={fieldErrors.email} onClear={() => setFieldErrors((current) => clearFieldError(current, 'email'))} /><button className="primary-button" type="submit">{t('authentication.sendLink')}</button></form>}</AuthFrame>;
}

export function ResetPasswordForm({ token, submit }: { token: string; submit: (input: { token: string; password: string }) => Promise<SubmitResult> }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'password'>>({});
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const errors = validateFields(event.currentTarget, ['password'], t); setFieldErrors(errors); if (Object.keys(errors).length > 0) return; const data = new FormData(event.currentTarget); const result = await submit({ token, password: String(data.get('password')) }); setState(result.ok ? 'success' : 'error'); }
  if (state === 'success') return <AuthFrame title={t('authentication.passwordUpdated')} description={t('authentication.passwordUpdatedDescription')}><Link className="primary-button button-link" href="/login">{t('authentication.login')}</Link></AuthFrame>;
  return <AuthFrame title={t('authentication.newPassword')} description={t('authentication.newPasswordDescription')}><form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}><Field label={t('authentication.newPassword')} name="password" type="password" autoComplete="new-password" minLength={12} error={fieldErrors.password} onClear={() => setFieldErrors((current) => clearFieldError(current, 'password'))} />{state === 'error' && <p className="auth-error" role="alert">{t('authentication.resetInvalid')}</p>}<button className="primary-button" type="submit">{t('authentication.savePassword')}</button></form></AuthFrame>;
}

export function InviteAcceptForm({ token, submit }: { token: string; submit: (input: { token: string; name: string; password: string }) => Promise<SubmitResult> }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'name' | 'password'>>({});
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const errors = validateFields(event.currentTarget, ['name', 'password'], t); setFieldErrors(errors); if (Object.keys(errors).length > 0) return; const data = new FormData(event.currentTarget); const result = await submit({ token, name: String(data.get('name')), password: String(data.get('password')) }); setState(result.ok ? 'success' : 'error'); }
  if (state === 'success') return <AuthFrame title={t('authentication.inviteAccepted')} description={t('authentication.inviteAcceptedDescription')}><Link className="primary-button button-link" href="/login">{t('authentication.login')}</Link></AuthFrame>;
  return <AuthFrame title={t('authentication.joinTitle')} description={t('authentication.joinDescription')}><form className="auth-form" noValidate onSubmit={(event) => void onSubmit(event)}><Field label={t('authentication.name')} name="name" autoComplete="name" maxLength={120} error={fieldErrors.name} onClear={() => setFieldErrors((current) => clearFieldError(current, 'name'))} /><Field label={t('authentication.password')} name="password" type="password" autoComplete="new-password" minLength={12} error={fieldErrors.password} onClear={() => setFieldErrors((current) => clearFieldError(current, 'password'))} />{state === 'error' && <p className="auth-error" role="alert">{t('authentication.inviteInvalid')}</p>}<button className="primary-button" type="submit">{t('authentication.join')}</button></form></AuthFrame>;
}

export function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { t } = useI18n();
  return <main className="auth-layout"><section className="auth-brand-panel"><Link className="brand" href="/">Sales AITO</Link><div><h1>{t('authentication.brandTitle')}</h1><p>{t('authentication.brandDescription')}</p></div></section><section className="auth-content"><div className="auth-card"><header><h2>{title}</h2><p>{description}</p></header>{children}</div></section></main>;
}

function Field({ label, hint, error, onClear, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string | undefined; name: string; error?: string | undefined; onClear: () => void }) {
  return <FormField className="auth-field" id={`auth-${input.name}`} label={label} hint={hint} error={error} required><input {...input} onChange={(event) => { onClear(); input.onChange?.(event); }} /></FormField>;
}

function validateFields<TField extends string>(form: HTMLFormElement, fields: readonly TField[], t: Translator): FieldErrors<TField> {
  const errors: FieldErrors<TField> = {};
  for (const field of fields) {
    const control = form.elements.namedItem(field);
    if (!(control instanceof HTMLInputElement)) continue;
    const message = nativeConstraintMessage(control, t);
    if (message) errors[field] = message;
  }
  focusFirstInvalid(form, Object.keys(errors));
  return errors;
}
