'use client';

import { useState } from 'react';

import { createTranslator } from '../i18n/translator';
import { useI18n } from '../i18n/i18n-provider';
import type { AppLocale } from '../i18n/locales';
import { useToast } from './toast-provider';

const localeOptions: Array<{ locale: AppLocale; short: string; labelKey: 'language.ukrainian' | 'language.english' }> = [
  { locale: 'uk', short: 'UA', labelKey: 'language.ukrainian' },
  { locale: 'en', short: 'EN', labelKey: 'language.english' },
];

export function LocaleSwitcher({ variant = 'header' }: { variant?: 'header' | 'profile' }) {
  const { locale, setLocale, t } = useI18n();
  const toast = useToast();
  const [pending, setPending] = useState<AppLocale | null>(null);

  async function change(nextLocale: AppLocale) {
    if (nextLocale === locale || pending) return;
    setPending(nextLocale);
    try {
      await setLocale(nextLocale);
      toast.show({ type: 'success', title: createTranslator(nextLocale)('language.updateSuccess') });
    } catch {
      toast.show({ type: 'error', title: t('language.updateError'), message: t('language.updateErrorHint') });
    } finally {
      setPending(null);
    }
  }

  return <div className={`locale-switcher locale-switcher-${variant}`} role="group" aria-label={t('language.label')} aria-busy={Boolean(pending)}>
    {localeOptions.map((option) => <button
      key={option.locale}
      type="button"
      aria-label={t(option.labelKey)}
      aria-pressed={locale === option.locale}
      disabled={Boolean(pending)}
      onClick={() => void change(option.locale)}
    >{variant === 'header' ? option.short : t(option.labelKey)}</button>)}
    {pending && <span className="sr-only" role="status">{t('language.updating')}</span>}
  </div>;
}
