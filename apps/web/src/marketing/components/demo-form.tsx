'use client';

import { type FormEvent, useRef, useState } from 'react';
import { parseValidationFailure } from '../../api/validation-errors';
import { FieldError, FormField } from '../../components/form-field';
import { clearFieldError, type FieldErrors } from '../../components/form-validation';
import { LoadingButton } from '../../components/loading-button';
import type { Locale } from '../routing/locales';

type DemoField = 'name' | 'company' | 'email' | 'phone' | 'orderVolume' | 'privacyConsent';
const fields = ['name', 'company', 'email', 'phone', 'orderVolume', 'privacyConsent'] as const;
const issueAllowlist = { name: ['INVALID_NAME'], company: ['INVALID_COMPANY'], email: ['INVALID_EMAIL'], phone: ['INVALID_PHONE'], orderVolume: ['INVALID_ORDER_VOLUME'], privacyConsent: ['CONSENT_REQUIRED'] } as const;

export function DemoForm({ locale }: { locale: Locale }) {
  const uk = locale === 'uk';
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<DemoField>>({});
  const idempotencyKey = useRef(crypto.randomUUID());
  const copy = (ua: string, en: string) => uk ? ua : en;
  const clear = (field: DemoField) => setFieldErrors((current) => clearFieldError(current, field));

  function message(field: DemoField, value = ''): string {
    if (field === 'name' || field === 'company') return value.trim().length < 2 ? copy('Введіть щонайменше 2 символи.', 'Enter at least 2 characters.') : copy('Перевірте введене значення.', 'Check this value.');
    if (field === 'email') return copy('Введіть коректну email-адресу.', 'Enter a valid email address.');
    if (field === 'phone') return copy('Введіть коректний телефон.', 'Enter a valid phone number.');
    if (field === 'orderVolume') return copy('Оберіть кількість замовлень.', 'Choose a monthly order range.');
    return copy('Потрібна згода на обробку даних.', 'Consent to data processing is required.');
  }

  function focus(form: HTMLFormElement, errors: FieldErrors<DemoField>): boolean {
    const first = fields.find((field) => errors[field]);
    if (!first) return false;
    (form.elements.namedItem(first) as HTMLElement | null)?.focus();
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (field: DemoField) => String(data.get(field) ?? '').trim();
    const errors: FieldErrors<DemoField> = {};
    if (value('name').length < 2 || value('name').length > 100) errors.name = message('name', value('name'));
    if (value('company').length < 2 || value('company').length > 160) errors.company = message('company', value('company'));
    if (value('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) errors.email = message('email');
    if (value('phone') && (value('phone').length < 7 || value('phone').length > 32)) errors.phone = message('phone');
    if (!value('email') && !value('phone')) errors.email = copy('Вкажіть email або телефон.', 'Enter an email or phone number.');
    if (!['UNDER_50', '50_TO_300', '301_TO_1500', 'OVER_1500'].includes(value('orderVolume'))) errors.orderVolume = message('orderVolume');
    if (!data.has('privacyConsent')) errors.privacyConsent = message('privacyConsent');
    setFieldErrors(errors);
    if (focus(form, errors)) return;

    setStatus('pending');
    const payload = Object.fromEntries(data.entries());
    try {
      const response = await fetch('/api/demo-leads', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey.current }, body: JSON.stringify({ ...payload, locale, privacyConsent: true }) });
      if (response.ok) { setStatus('success'); return; }
      const failure = await parseValidationFailure(response, issueAllowlist);
      if (failure) {
        const next: FieldErrors<DemoField> = {};
        for (const issue of failure.issues) {
          const field = issue.field as DemoField;
          next[field] = message(field, String(payload[field] ?? ''));
        }
        setFieldErrors(next);
        focus(form, next);
        setStatus('idle');
      } else setStatus('error');
    } catch { setStatus('error'); }
  }

  if (status === 'success') return <div className="demo-form" role="status"><h2>{copy('Заявку отримано', 'Request received')}</h2><p>{copy('Команда Sales AITO зв’яжеться з вами, щоб узгодити демо.', 'The Sales AITO team will contact you to arrange the demo.')}</p></div>;

  return <form className="demo-form" onSubmit={(event) => void submit(event)} noValidate aria-describedby="demo-form-status">
    <FormField id="demo-name" label={copy('Ім’я', 'Name')} error={fieldErrors.name} required><input name="name" minLength={2} maxLength={100} autoComplete="name" onChange={() => clear('name')} /></FormField>
    <FormField id="demo-company" label={copy('Компанія або магазин', 'Company or store')} error={fieldErrors.company} required><input name="company" minLength={2} maxLength={160} autoComplete="organization" onChange={() => clear('company')} /></FormField>
    <FormField id="demo-email" label="Email" error={fieldErrors.email}><input name="email" type="email" maxLength={254} autoComplete="email" onChange={() => clear('email')} /></FormField>
    <FormField id="demo-phone" label={copy('Телефон', 'Phone')} error={fieldErrors.phone}><input name="phone" type="tel" minLength={7} maxLength={32} autoComplete="tel" onChange={() => clear('phone')} /></FormField>
    <FormField id="demo-orderVolume" label={copy('Замовлень на місяць', 'Monthly orders')} error={fieldErrors.orderVolume} required><select name="orderVolume" defaultValue="" onChange={() => clear('orderVolume')}><option value="" disabled>{copy('Оберіть діапазон', 'Choose a range')}</option><option value="UNDER_50">{copy('До 50', 'Under 50')}</option><option value="50_TO_300">50-300</option><option value="301_TO_1500">301-1,500</option><option value="OVER_1500">{copy('Понад 1 500', 'Over 1,500')}</option></select></FormField>
    <FormField id="demo-note" label={copy('Що хочете автоматизувати?', 'What would you like to automate?')}><textarea name="note" maxLength={1000} /></FormField>
    <label className="demo-form__consent"><input name="privacyConsent" type="checkbox" aria-invalid={Boolean(fieldErrors.privacyConsent)} aria-describedby={fieldErrors.privacyConsent ? 'demo-privacyConsent-error' : undefined} onChange={() => clear('privacyConsent')} /><span>{copy('Погоджуюсь на обробку даних для організації демо.', 'I agree to data processing for arranging the demo.')}</span></label>
    <FieldError id="demo-privacyConsent-error" message={fieldErrors.privacyConsent} />
    <LoadingButton className="primary-button marketing-button" type="submit" pending={status === 'pending'} pendingLabel={copy('Надсилаємо…', 'Sending…')}>{copy('Замовити демо', 'Book a demo')}</LoadingButton>
    <p className="demo-form__status" id="demo-form-status" role="status">{status === 'error' ? copy('Не вдалося надіслати. Перевірте контактні дані й спробуйте ще раз.', 'Could not submit. Check your contact details and try again.') : ''}</p>
  </form>;
}
