'use client';

import Link from 'next/link';
import { type FormEvent, type ReactNode, useState } from 'react';

type SubmitResult = { ok: boolean; previewUrl?: string };

export function LoginForm({ submit }: { submit: (input: { email: string; password: string }) => Promise<SubmitResult> }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'error'>('idle');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState('submitting');
    const data = new FormData(event.currentTarget);
    const result = await submit({ email: String(data.get('email')), password: String(data.get('password')) });
    setState(result.ok ? 'idle' : 'error');
  }
  return <AuthFrame title="Вхід в AutoSale" description="Продовжуйте роботу із замовленнями та діалогами.">
    <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Пароль" name="password" type="password" autoComplete="current-password" />
      {state === 'error' && <p className="auth-error" role="alert">Не вдалося увійти. Перевірте email і пароль.</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? 'Входимо…' : 'Увійти'}</button>
      <Link className="auth-link" href="/forgot-password">Забули пароль?</Link>
    </form>
    <p className="auth-switch">Ще немає акаунта? <Link href="/register">Зареєструватися</Link></p>
  </AuthFrame>;
}

export function RegisterForm({ submit }: { submit: (input: { name: string; tenantName: string; email: string; password: string }) => Promise<SubmitResult> }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState('submitting');
    const data = new FormData(event.currentTarget);
    const result = await submit({ name: String(data.get('name')), tenantName: String(data.get('tenantName')), email: String(data.get('email')), password: String(data.get('password')) });
    setPreviewUrl(result.previewUrl);
    setState(result.ok ? 'success' : 'error');
  }
  if (state === 'success') return <AuthFrame title="Перевірте вашу електронну пошту" description="Ми надіслали посилання для активації акаунта.">{previewUrl && <Link className="primary-button button-link" data-testid="dev-verification-link" href={previewUrl}>Активувати тестовий акаунт</Link>}<Link className="auth-link" href="/login">Перейти до входу</Link></AuthFrame>;
  return <AuthFrame title="Створіть робочий простір" description="Зареєструйте власника та організацію AutoSale.">
    <form className="auth-form" onSubmit={(event) => void onSubmit(event)}>
      <Field label="Ім’я" name="name" autoComplete="name" />
      <Field label="Назва організації" name="tenantName" autoComplete="organization" />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field label="Пароль" name="password" type="password" autoComplete="new-password" minLength={12} hint="Щонайменше 12 символів" />
      {state === 'error' && <p className="auth-error" role="alert">Не вдалося створити акаунт.</p>}
      <button className="primary-button" disabled={state === 'submitting'} type="submit">{state === 'submitting' ? 'Створюємо…' : 'Зареєструватися'}</button>
    </form>
    <p className="auth-switch">Вже маєте акаунт? <Link href="/login">Увійти</Link></p>
  </AuthFrame>;
}

export function ForgotPasswordForm({ submit }: { submit: (input: { email: string }) => Promise<SubmitResult> }) {
  const [sent, setSent] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); await submit({ email: String(data.get('email')) }); setSent(true); }
  return <AuthFrame title="Відновлення пароля" description="Вкажіть email власника або менеджера.">{sent ? <><p className="auth-success">Якщо акаунт існує, лист уже надіслано.</p><Link className="auth-link" href="/login">Повернутися до входу</Link></> : <form className="auth-form" onSubmit={(event) => void onSubmit(event)}><Field label="Email" name="email" type="email" autoComplete="email" /><button className="primary-button" type="submit">Надіслати посилання</button></form>}</AuthFrame>;
}

export function ResetPasswordForm({ token, submit }: { token: string; submit: (input: { token: string; password: string }) => Promise<SubmitResult> }) {
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const result = await submit({ token, password: String(data.get('password')) }); setState(result.ok ? 'success' : 'error'); }
  if (state === 'success') return <AuthFrame title="Пароль оновлено" description="Тепер можна увійти з новим паролем."><Link className="primary-button button-link" href="/login">Увійти</Link></AuthFrame>;
  return <AuthFrame title="Новий пароль" description="Створіть новий пароль щонайменше з 12 символів."><form className="auth-form" onSubmit={(event) => void onSubmit(event)}><Field label="Новий пароль" name="password" type="password" autoComplete="new-password" minLength={12} />{state === 'error' && <p className="auth-error" role="alert">Посилання недійсне або протерміноване.</p>}<button className="primary-button" type="submit">Зберегти пароль</button></form></AuthFrame>;
}

export function InviteAcceptForm({ token, submit }: { token: string; submit: (input: { token: string; name: string; password: string }) => Promise<SubmitResult> }) {
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  async function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const result = await submit({ token, name: String(data.get('name')), password: String(data.get('password')) }); setState(result.ok ? 'success' : 'error'); }
  if (state === 'success') return <AuthFrame title="Запрошення прийнято" description="Ваш доступ менеджера активовано."><Link className="primary-button button-link" href="/login">Увійти</Link></AuthFrame>;
  return <AuthFrame title="Приєднатися до команди" description="Створіть профіль менеджера для роботи в AutoSale."><form className="auth-form" onSubmit={(event) => void onSubmit(event)}><Field label="Ім’я" name="name" autoComplete="name" /><Field label="Пароль" name="password" type="password" autoComplete="new-password" minLength={12} />{state === 'error' && <p className="auth-error" role="alert">Запрошення недійсне або протерміноване.</p>}<button className="primary-button" type="submit">Приєднатися</button></form></AuthFrame>;
}

export function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="auth-layout"><section className="auth-brand-panel"><Link className="brand" href="/">AutoSale</Link><div><h1>Замовлення з чатів — у зрозумілому робочому процесі.</h1><p>AI розпізнає дані, менеджер контролює результат, а команда працює в одному просторі.</p></div></section><section className="auth-content"><div className="auth-card"><header><h2>{title}</h2><p>{description}</p></header>{children}</div></section></main>;
}

function Field({ label, hint, ...input }: { label: string; hint?: string; name: string; type?: string; autoComplete?: string; minLength?: number }) {
  return <label className="auth-field"><span>{label}</span><input required {...input} />{hint && <small>{hint}</small>}</label>;
}
