'use client';

import type { AdminDemoLeadDetail, AdminDemoLeadStatus } from '../../../../packages/contracts/src/admin-demo-leads';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, type FieldErrors } from './form-validation';
import { LoadingButton } from './loading-button';

const nextStatus: Record<AdminDemoLeadStatus, AdminDemoLeadStatus> = {
  NEW: 'CONTACTED', CONTACTED: 'QUALIFIED', QUALIFIED: 'CLOSED', CLOSED: 'CONTACTED',
};

export function AdminDemoLeadDetail({ lead }: { lead: AdminDemoLeadDetail }) {
  const router = useRouter();
  const { locale, formatDate } = useI18n();
  const text = getAdminCopy(locale).leads;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<'export' | 'delete' | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [dataPending, setDataPending] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'currentPassword' | 'confirmId'>>({});
  const target = nextStatus[lead.status];
  const actionLabel = lead.status === 'NEW' ? text.actionLabels.CONTACTED : lead.status === 'CONTACTED' ? text.actionLabels.QUALIFIED : lead.status === 'QUALIFIED' ? text.actionLabels.CLOSED : text.actionLabels.REOPEN;

  async function advance() {
    setPending(true);
    setError(null);
    try {
      const response = await mutatingFetch(`/api/admin/demo-leads/${lead.id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: target, expectedVersion: lead.version }),
      });
      if (response.status === 409) { setError(text.changed); return; }
      if (!response.ok) throw new Error('status_failed');
      router.refresh();
    } catch { setError(text.mutationFailed); }
    finally { setPending(false); }
  }

  async function submitData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dataMode) return;
    const errors: FieldErrors<'currentPassword' | 'confirmId'> = {};
    if (!password) errors.currentPassword = text.data.required;
    if (dataMode === 'delete' && confirmation !== lead.id) errors.confirmId = confirmation ? text.data.mismatch : text.data.required;
    setFieldErrors(errors);
    if (Object.keys(errors).length) { focusFirstInvalid(event.currentTarget, ['confirmId', 'currentPassword']); return; }
    setDataPending(true);
    setDataError(null);
    try {
      const reauth = await mutatingFetch('/api/admin/reauth', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: password, purpose: dataMode === 'export' ? 'DEMO_LEAD_EXPORT' : 'DEMO_LEAD_DELETE' }) });
      if (!reauth.ok) throw new Error('reauth_failed');
      const { stepUpToken } = await reauth.json() as { stepUpToken: string };
      if (dataMode === 'delete') {
        const response = await mutatingFetch(`/api/admin/demo-leads/${lead.id}/delete`, { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-admin-step-up': stepUpToken }, body: JSON.stringify({ confirmId: confirmation }) });
        if (response.status === 409) { setDataError(text.data.busy); return; }
        if (!response.ok) throw new Error('delete_failed');
        router.replace('/admin/leads');
      } else {
        const response = await fetch(`/api/admin/demo-leads/${lead.id}/export`, { headers: { 'x-admin-step-up': stepUpToken }, cache: 'no-store' });
        if (!response.ok) throw new Error('export_failed');
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `sales-aito-demo-lead-${lead.id}.json`;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setPassword(''); setConfirmation(''); setDataMode(null);
    } catch { setDataError(text.data.failed); }
    finally { setDataPending(false); }
  }

  return <div className="admin-page admin-tenant-detail">
    <Link className="text-button admin-back-link" href="/admin/leads" aria-label={text.back}>← {text.back}</Link>
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.detailEyebrow}</span><h1>{lead.company}</h1><p>{lead.id.slice(0, 8).toUpperCase()}</p></div><span className="admin-access-status">{text.statuses[lead.status]}</span></header>
    <section className="admin-detail-summary" aria-label={lead.company}>
      <div><span>{text.name}</span><strong>{lead.name}</strong></div><div><span>{text.email}</span><strong>{lead.email ?? '—'}</strong></div><div><span>{text.phone}</span><strong>{lead.phone ?? '—'}</strong></div><div><span>{text.volume}</span><strong>{lead.orderVolume}</strong></div><div><span>{text.columns.notification}</span><strong>{text.notifications[lead.notificationStatus]}</strong></div><div><span>{text.columns.created}</span><strong>{formatDate(lead.createdAt, { dateStyle: 'long', timeStyle: 'short' })}</strong></div>
    </section>
    <section className="admin-detail-grid admin-lead-detail-grid">
      <article className="admin-panel admin-access-panel"><h2>{text.actionTitle}</h2><p>{text.actionDescription}</p><LoadingButton className="primary-button" type="button" pending={pending} pendingLabel={text.saving} onClick={() => void advance()}>{actionLabel}</LoadingButton>{error && <p className="admin-form-error" role="alert">{error}</p>}</article>
      <article className="admin-panel admin-data-panel"><h2>{text.note}</h2><p className="admin-lead-note">{lead.note ?? '—'}</p><div className="admin-lead-consent"><span>{text.consent}</span><strong>{lead.consentVersion} · {formatDate(lead.consentedAt, { dateStyle: 'medium' })}</strong></div></article>
    </section>
    <section className="admin-panel admin-lead-data-actions"><h2>{text.data.title}</h2><p>{text.data.description}</p>
      <div className="admin-reauth-actions"><button className="secondary-button" type="button" disabled={dataPending} onClick={() => { setDataMode('export'); setDataError(null); setFieldErrors({}); }}>{text.data.export}</button>{lead.deletionAvailable && <button className="danger-button" type="button" disabled={dataPending} onClick={() => { setDataMode('delete'); setDataError(null); setFieldErrors({}); }}>{text.data.delete}</button>}</div>
      {dataMode && <form className="admin-reauth-form" noValidate onSubmit={(event) => void submitData(event)}>
        {dataMode === 'delete' && <FormField id="confirmId" label={text.data.confirmId} hint={text.data.confirmHint} error={fieldErrors.confirmId} required><input name="confirmId" value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setFieldErrors((current) => clearFieldError(current, 'confirmId')); }} /></FormField>}
        <FormField id="currentPassword" label={text.data.password} error={fieldErrors.currentPassword} required><input type="password" name="currentPassword" value={password} onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => clearFieldError(current, 'currentPassword')); }} /></FormField>
        {dataError && <p className="admin-form-error" role="alert">{dataError}</p>}
        <div className="admin-reauth-actions"><button className="secondary-button" type="button" disabled={dataPending} onClick={() => setDataMode(null)}>{text.data.cancel}</button><LoadingButton className={dataMode === 'delete' ? 'danger-button' : 'primary-button'} type="submit" pending={dataPending} pendingLabel={text.data.working}>{text.data.submit}</LoadingButton></div>
      </form>}
    </section>
  </div>;
}
