'use client';

import { useRef, useState } from 'react';

import type { Locale } from '../routing/locales';

export function DemoForm({ locale }: { locale: Locale }) {
  const uk = locale === 'uk';
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  async function submit(formData: FormData) {
    setStatus('pending');
    const payload = Object.fromEntries(formData.entries());
    try {
      const response = await fetch('/api/demo-leads', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey.current }, body: JSON.stringify({ ...payload, locale, privacyConsent: payload.privacyConsent === 'on' }) });
      setStatus(response.ok ? 'success' : 'error');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return <div className="demo-form" role="status"><h2>{uk ? 'Заявку отримано' : 'Request received'}</h2><p>{uk ? 'Команда Sales AITO зв’яжеться з вами, щоб узгодити демо.' : 'The Sales AITO team will contact you to arrange the demo.'}</p></div>;
  }

  return (
    <form className="demo-form" action={submit} aria-describedby="demo-form-status">
      <label>{uk ? 'Ім’я' : 'Name'}<input name="name" minLength={2} maxLength={100} required autoComplete="name" /></label>
      <label>{uk ? 'Компанія або магазин' : 'Company or store'}<input name="company" minLength={2} maxLength={160} required autoComplete="organization" /></label>
      <label>Email<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>{uk ? 'Телефон' : 'Phone'}<input name="phone" type="tel" minLength={7} maxLength={32} autoComplete="tel" /></label>
      <label>{uk ? 'Замовлень на місяць' : 'Monthly orders'}<select name="orderVolume" required defaultValue=""><option value="" disabled>{uk ? 'Оберіть діапазон' : 'Choose a range'}</option><option value="UNDER_50">{uk ? 'До 50' : 'Under 50'}</option><option value="50_TO_300">50-300</option><option value="301_TO_1500">301-1,500</option><option value="OVER_1500">{uk ? 'Понад 1 500' : 'Over 1,500'}</option></select></label>
      <label>{uk ? 'Що хочете автоматизувати?' : 'What would you like to automate?'}<textarea name="note" maxLength={1000} /></label>
      <label className="demo-form__consent"><input name="privacyConsent" type="checkbox" required /><span>{uk ? 'Погоджуюсь на обробку даних для організації демо.' : 'I agree to data processing for arranging the demo.'}</span></label>
      <button className="marketing-button" type="submit" disabled={status === 'pending'}>{status === 'pending' ? (uk ? 'Надсилаємо…' : 'Sending…') : (uk ? 'Замовити демо' : 'Book a demo')}</button>
      <p className="demo-form__status" id="demo-form-status" role="status">{status === 'error' ? (uk ? 'Не вдалося надіслати. Перевірте контактні дані й спробуйте ще раз.' : 'Could not submit. Check your contact details and try again.') : ''}</p>
    </form>
  );
}
