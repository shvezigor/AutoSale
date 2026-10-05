'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { ReplyStyle } from '../../../../packages/contracts/src/reply-drafts';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { FormField } from './form-field';
import { LoadingButton } from './loading-button';

type Field = 'companyName' | 'guidance';

export function ReplyStyleSettings({ initial, canEdit }: { initial: ReplyStyle; canEdit: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const guidanceRef = useRef<HTMLTextAreaElement>(null);

  function change<K extends keyof ReplyStyle>(field: K, value: ReplyStyle[K]) {
    setStyle((current) => ({ ...current, [field]: value }));
    if (field === 'companyName' || field === 'guidance') setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<Field, string>> = {};
    if (style.enabled && !style.companyName.trim()) nextErrors.companyName = t('settings.replyCompanyRequired');
    else if (style.companyName.trim().length > 120) nextErrors.companyName = t('settings.replyCompanyLong');
    if (style.guidance.trim().length > 500) nextErrors.guidance = t('settings.replyGuidanceLong');
    setErrors(nextErrors);
    if (nextErrors.companyName) { companyRef.current?.focus(); return; }
    if (nextErrors.guidance) { guidanceRef.current?.focus(); return; }
    setSaving(true);
    try {
      const response = await mutatingFetch('/api/settings/reply-style', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: style.enabled, companyName: style.companyName.trim(), tone: style.tone,
          addressForm: style.addressForm, guidance: style.guidance.trim() }),
      });
      if (!response.ok) { setNotice(t('settings.replySaveFailed')); return; }
      setStyle(await response.json() as ReplyStyle);
      setNotice(t('settings.replySaved'));
    } catch { setNotice(t('settings.replySaveFailed')); }
    finally { setSaving(false); }
  }

  return <section className={`delivery-carrier reply-style-settings ${open ? 'is-open' : ''}`}>
    <button className="delivery-carrier-trigger" id="reply-style-trigger" type="button"
      aria-expanded={open} aria-controls="reply-style-panel" onClick={() => setOpen(!open)}>
      <span className="delivery-carrier-mark" aria-hidden="true">AI</span>
      <span className="delivery-carrier-copy"><strong>{t('settings.replyStyleTitle')}</strong>
        <small>{t('settings.replyStyleDescription')}</small></span>
      <span className={`connection-status status-${style.enabled ? 'active' : 'pending'}`}>
        {style.enabled ? t('settings.active') : t('settings.disabled')}
      </span>
      <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    {open && <div className="delivery-carrier-panel" id="reply-style-panel" role="region" aria-labelledby="reply-style-trigger">
      <div className="settings-card" aria-labelledby="reply-style-title">
    <div className="settings-card-heading"><div>
      <h2 id="reply-style-title">{t('settings.replyStyleTitle')}</h2>
      <p>{t('settings.replyStyleDescription')}</p>
    </div></div>
    <form className="reply-style-form" onSubmit={(event) => void save(event)}>
      <div className="settings-subsection reply-style-toggle-section">
        <label className="reply-style-toggle"><input type="checkbox" checked={style.enabled} disabled={!canEdit || saving}
          onChange={(event) => change('enabled', event.target.checked)} /> <span>{t('settings.replyEnable')}</span></label>
      </div>
      <div className="reply-style-fields">
        <FormField id="reply-company-name" className="reply-style-field" label={t('settings.replyCompany')} error={errors.companyName}>
          <input ref={companyRef} value={style.companyName} maxLength={121} disabled={!canEdit || saving}
            onChange={(event) => change('companyName', event.target.value)} />
        </FormField>
        <FormField id="reply-tone" className="reply-style-field" label={t('settings.replyTone')}>
          <select value={style.tone} disabled={!canEdit || saving}
            onChange={(event) => change('tone', event.target.value as ReplyStyle['tone'])}>
            <option value="FRIENDLY">{t('settings.replyToneFriendly')}</option>
            <option value="NEUTRAL">{t('settings.replyToneNeutral')}</option>
            <option value="FORMAL">{t('settings.replyToneFormal')}</option>
          </select>
        </FormField>
        <FormField id="reply-address-form" className="reply-style-field" label={t('settings.replyAddress')}>
          <select value={style.addressForm} disabled={!canEdit || saving}
            onChange={(event) => change('addressForm', event.target.value as ReplyStyle['addressForm'])}>
            <option value="FORMAL_YOU">{t('settings.replyAddressFormal')}</option>
            <option value="INFORMAL_YOU">{t('settings.replyAddressInformal')}</option>
          </select>
        </FormField>
        <FormField id="reply-guidance" className="reply-style-field reply-style-field-wide" label={t('settings.replyGuidance')} error={errors.guidance}
          hint={t('settings.replyGuidanceHint')}>
          <textarea ref={guidanceRef} value={style.guidance} maxLength={501} rows={3} disabled={!canEdit || saving}
            onChange={(event) => change('guidance', event.target.value)} />
        </FormField>
      </div>
      {notice && <p role="status" className="settings-form-notice">{notice}</p>}
      {canEdit && <div className="settings-actions"><LoadingButton pending={saving} type="submit">
        {t('settings.saveSettings')}
      </LoadingButton></div>}
    </form></div></div>}
  </section>;
}
