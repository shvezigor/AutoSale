'use client';

import type { AdminDemoLeadDetail, AdminDemoLeadStatus } from '../../../../packages/contracts/src/admin-demo-leads';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
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
  </div>;
}
