'use client';

import type { AdminConversionReport } from '../../../../packages/contracts/src/conversion-events';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

import { useI18n } from '../i18n/i18n-provider';
import { FormField } from './form-field';
import { clearFieldError, type FieldErrors } from './form-validation';

const titles = {
  pricing_view: ['Перегляди тарифів', 'Pricing page views'],
  registration_arrival: ['Переходи до реєстрації', 'Registration arrivals'],
  plan_interest: ['Натискання тарифів', 'Plan clicks'],
  account_registered: ['Створені організації', 'Registered organizations'],
  demo_intent: ['Прийняті демозаявки', 'Accepted demo requests'],
  first_order_confirmed: ['Перші підтверджені замовлення', 'First confirmed orders'],
  registration_cohort_first_order: ['Організації з першим замовленням', 'Registered organizations with a first order'],
  first_order_cohort_plan_interest: ['Перші замовлення з подальшим інтересом', 'First-order organizations with later plan interest'],
  tenant_plan_interest: ['Організації, що обговорювали тариф', 'Organizations discussing a plan'],
} as const;

export function AdminConversionsReport({ initial }: { initial: AdminConversionReport }) {
  const { locale } = useI18n();
  const uk = locale === 'uk';
  const router = useRouter();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [errors, setErrors] = useState<FieldErrors<'from' | 'to'>>({});
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const copy = (ua: string, en: string) => uk ? ua : en;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FieldErrors<'from' | 'to'> = {};
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!from || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== from) next.from = copy('Введіть коректну дату.', 'Enter a valid date.');
    if (!to || !Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== to) next.to = copy('Введіть коректну дату.', 'Enter a valid date.');
    const today = new Date().toISOString().slice(0, 10);
    if (!next.from && !next.to && (start > end || end - start > 89 * 86_400_000 || to > today)) {
      next.to = copy('Оберіть період до 90 днів без майбутніх дат.', 'Choose up to 90 days without future dates.');
    }
    setErrors(next);
    if (next.from) { fromRef.current?.focus(); return; }
    if (next.to) { toRef.current?.focus(); return; }
    router.push(`/admin/conversions?from=${from}&to=${to}`);
  }

  const rate = (value: number | null) => value === null ? copy('Недостатньо даних', 'Not enough data') : `${Math.round(value * 100)}%`;
  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{copy('Приватна аналітика', 'Privacy-minimal analytics')}</span><h1>{copy('Конверсії', 'Conversions')}</h1><p>{copy('Лише зведені показники; без контактів, текстів повідомлень та ідентифікаторів клієнтів.', 'Aggregate counts only; no contacts, message text, or customer identifiers.')}</p></div></header>
    <form className="admin-conversions-filter" onSubmit={submit} noValidate>
      <FormField id="admin-conversions-from" label={copy('Від дати', 'From')} error={errors.from} required><input ref={fromRef} type="date" value={from} onChange={(event) => { setFrom(event.target.value); setErrors((current) => clearFieldError(current, 'from')); }} /></FormField>
      <FormField id="admin-conversions-to" label={copy('До дати', 'Through')} error={errors.to} required><input ref={toRef} type="date" value={to} onChange={(event) => { setTo(event.target.value); setErrors((current) => clearFieldError(current, 'to')); }} /></FormField>
      <button className="secondary-button" type="submit">{copy('Показати', 'Show report')}</button>
    </form>
    <p className="admin-conversions-note">{copy('Перегляди й натискання — кількість дій, не унікальних відвідувачів. Значення менші за 3 приховано.', 'Views and clicks count actions, not unique visitors. Values below 3 are hidden.')}</p>
    <div className="admin-metric-grid admin-conversions-grid">{initial.metrics.filter((item) => !item.metric.includes('cohort')).map((item) => <article className="admin-metric-card" key={`${item.metric}-${item.locale}-${item.planId}`}>
      <span>{titles[item.metric as keyof typeof titles]?.[uk ? 0 : 1] ?? item.metric}{item.planId !== 'none' ? ` · ${item.planId}` : ''}{item.locale !== 'all' ? ` · ${item.locale.toUpperCase()}` : ''}</span>
      <strong>{item.count === null ? '—' : item.count.toLocaleString(uk ? 'uk-UA' : 'en-US')}</strong>
    </article>)}</div>
    <section className="admin-conversions-rates" aria-label={copy('Когортні коефіцієнти', 'Cohort rates')}>
      <article className="admin-metric-card"><span>{copy('Реєстрація → перше замовлення', 'Registration → first order')}</span><strong>{rate(initial.rates.registrationToFirstOrder)}</strong></article>
      <article className="admin-metric-card"><span>{copy('Перше замовлення → інтерес до тарифу', 'First order → plan interest')}</span><strong>{rate(initial.rates.firstOrderToPlanInterest)}</strong></article>
    </section>
    <p className="admin-conversions-note">{copy('Другий коефіцієнт доступний лише для періоду, який повністю входить у 90-денне вікно збереження інтересу.', 'The second rate is available only for a period fully inside the 90-day plan-interest retention window.')}</p>
  </div>;
}
