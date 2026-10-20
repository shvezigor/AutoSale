'use client';

import type { AdminDemoLeadList, AdminDemoLeadStatus } from '../../../../packages/contracts/src/admin-demo-leads';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { LoadingButton } from './loading-button';

export function AdminDemoLeadsTable({ initial, status }: { initial: AdminDemoLeadList; status: 'ALL' | AdminDemoLeadStatus }) {
  const router = useRouter();
  const { locale, formatDate } = useI18n();
  const text = getAdminCopy(locale).leads;
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      if (status !== 'ALL') params.set('status', status);
      const response = await fetch(`/api/admin/demo-leads?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load_failed');
      const page = await response.json() as AdminDemoLeadList;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.description}</p></div></header>
    <div className="admin-table-toolbar admin-leads-toolbar"><label><span>{text.statusLabel}</span><select value={status} onChange={(event) => router.push(event.target.value === 'ALL' ? '/admin/leads' : `/admin/leads?status=${event.target.value}`)}><option value="ALL">{text.allStatuses}</option>{(['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED'] as const).map((option) => <option key={option} value={option}>{text.statuses[option]}</option>)}</select></label></div>
    <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>{text.columns.company}</th><th>{text.columns.contact}</th><th>{text.columns.status}</th><th>{text.columns.notification}</th><th>{text.columns.created}</th><th><span className="sr-only">{text.columns.action}</span></th></tr></thead><tbody>{items.length === 0 ? <tr><td className="admin-table-empty" colSpan={6}>{text.empty}</td></tr> : items.map((lead) => <tr className="admin-clickable-row" key={lead.id} tabIndex={0} onClick={() => router.push(`/admin/leads/${lead.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); router.push(`/admin/leads/${lead.id}`); } }}><td data-label={text.columns.company}><strong>{lead.company}</strong></td><td data-label={text.columns.contact}>{lead.maskedContact}</td><td data-label={text.columns.status}><span className="admin-access-status">{text.statuses[lead.status]}</span></td><td data-label={text.columns.notification}>{text.notifications[lead.notificationStatus]}</td><td data-label={text.columns.created}>{formatDate(lead.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</td><td data-label={text.columns.action}><Link className="secondary-button" href={`/admin/leads/${lead.id}`} onClick={(event) => event.stopPropagation()}>{text.view}</Link></td></tr>)}</tbody></table></div>
    {nextCursor && <div className="admin-leads-footer"><LoadingButton className="secondary-button" type="button" pending={loading} pendingLabel={text.loading} onClick={() => void loadMore()}>{text.loadMore}</LoadingButton></div>}
    {error && <p className="admin-form-error" role="alert">{text.loadFailed}</p>}
  </div>;
}
