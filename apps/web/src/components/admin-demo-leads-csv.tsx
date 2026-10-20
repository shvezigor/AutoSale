'use client';

import { useState, type FormEvent } from 'react';

import type { AdminDemoLeadStatus } from '../../../../packages/contracts/src/admin-demo-leads';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, type FieldErrors } from './form-validation';
import { LoadingButton } from './loading-button';

type CsvField = 'from' | 'to' | 'currentPassword';

export function AdminDemoLeadsCsv({ status }: { status: 'ALL' | AdminDemoLeadStatus }) {
  const text = getAdminCopy(useI18n().locale).leads.csv;
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(monthAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<CsvField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FieldErrors<CsvField> = {};
    if (!from) next.from = text.required;
    if (!to) next.to = text.required;
    if (from && to && from > to) next.to = text.range;
    if (!currentPassword) next.currentPassword = text.required;
    setErrors(next);
    if (Object.keys(next).length) { focusFirstInvalid(event.currentTarget, ['from', 'to', 'currentPassword'].filter((field) => field in next)); return; }
    setPending(true);
    setFormError(null);
    try {
      const reauth = await mutatingFetch('/api/admin/reauth', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, purpose: 'DEMO_LEAD_EXPORT' }) });
      if (!reauth.ok) throw new Error('reauth_failed');
      const { stepUpToken } = await reauth.json() as { stepUpToken: string };
      const params = new URLSearchParams({ from, to });
      if (status !== 'ALL') params.set('status', status);
      const response = await fetch(`/api/admin/demo-leads/export.csv?${params}`, { headers: { 'x-admin-step-up': stepUpToken }, cache: 'no-store' });
      if (response.status === 413) { setFormError(text.limit); return; }
      if (!response.ok) throw new Error('download_failed');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sales-aito-demo-leads.csv';
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCurrentPassword(''); setOpen(false);
    } catch { setFormError(text.failed); }
    finally { setPending(false); }
  }

  return <div className="admin-leads-csv">
    <button className="secondary-button" type="button" aria-expanded={open} onClick={() => { setOpen(!open); setFormError(null); }}>{text.open}</button>
    {open && <form className="admin-reauth-form" noValidate onSubmit={(event) => void submit(event)}>
      <h2>{text.title}</h2>
      <div className="admin-detail-grid">
        <FormField id="from" label={text.from} error={errors.from} required><input name="from" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setErrors((current) => clearFieldError(current, 'from')); }} /></FormField>
        <FormField id="to" label={text.to} error={errors.to} required><input name="to" type="date" value={to} onChange={(event) => { setTo(event.target.value); setErrors((current) => clearFieldError(current, 'to')); }} /></FormField>
      </div>
      <FormField id="currentPassword" label={text.password} error={errors.currentPassword} required><input name="currentPassword" type="password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setErrors((current) => clearFieldError(current, 'currentPassword')); }} /></FormField>
      {formError && <p className="admin-form-error" role="alert">{formError}</p>}
      <div className="admin-reauth-actions"><button className="secondary-button" type="button" disabled={pending} onClick={() => setOpen(false)}>{text.cancel}</button><LoadingButton className="primary-button" type="submit" pending={pending} pendingLabel={text.working}>{text.submit}</LoadingButton></div>
    </form>}
  </div>;
}
