'use client';

import type { AdminTenantSummary } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';
import { AdminTenantLifecycle } from './admin-tenant-lifecycle';
import { LoadingButton } from './loading-button';
import { useConfirm } from './confirm-provider';

export function AdminTenantDetail({ tenant }: { tenant: AdminTenantSummary }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { locale, formatDate, formatNumber } = useI18n();
  const text = getAdminCopy(locale).clientDetail;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = tenant.status === 'ACTIVE';

  async function toggleAccess() {
    const approved = await confirm({
      title: (active ? text.blockTitle : text.unblockTitle).replace('{name}', tenant.tenantName),
      description: active ? text.blockDescription : text.unblockDescription,
      confirmLabel: active ? text.blockConfirm : text.unblockConfirm,
      tone: active ? 'danger' : 'default',
    });
    if (!approved) return;
    setPending(true);
    setError(null);
    try {
      const response = await mutatingFetch(`/api/admin/tenants/${tenant.tenantId}/${active ? 'block' : 'unblock'}`, { method: 'POST' });
      if (!response.ok) throw new Error('tenant_access_update_failed');
      router.refresh();
    } catch {
      setError(text.mutationFailed);
    } finally {
      setPending(false);
    }
  }

  return <div className="admin-page admin-tenant-detail">
    <Link className="text-button admin-back-link" href="/admin/tenants" aria-label={text.back}>← {text.back}</Link>
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.eyebrow}</span><h1>{tenant.tenantName}</h1><p>ID {tenant.tenantId.slice(0, 8).toUpperCase()}</p></div><span className={`admin-access-status status-${tenant.status.toLowerCase()}`}>{active ? text.active : text.blocked}</span></header>
    <section className="admin-detail-summary" aria-label={tenant.tenantName}>
      <div><span>{text.owner}</span><strong>{tenant.ownerEmail ?? '—'}</strong></div><div><span>{text.users}</span><strong>{formatNumber(tenant.userCount)}</strong></div><div><span>{text.orders}</span><strong>{formatNumber(tenant.orderCount)}</strong></div><div><span>{text.created}</span><strong>{formatDate(tenant.createdAt, { dateStyle: 'long' })}</strong></div><div><span>{text.status}</span><strong>{active ? text.active : text.blocked}</strong></div>
    </section>
    <section className="admin-detail-grid">
      <article className="admin-panel admin-access-panel"><div><h2>{text.accessTitle}</h2><p>{text.accessDescription}</p></div><LoadingButton className={active ? 'danger-button' : 'primary-button'} pending={pending} pendingLabel={active ? text.blocking : text.unblocking} type="button" onClick={() => void toggleAccess()}>{active ? text.block : text.unblock}</LoadingButton>{error && <p className="admin-form-error" role="alert">{error}</p>}</article>
      <article className="admin-panel admin-data-panel"><header><h2>{text.dataTitle}</h2><p>{text.dataDescription}</p></header><AdminTenantLifecycle tenantId={tenant.tenantId} tenantName={tenant.tenantName} /></article>
    </section>
  </div>;
}
