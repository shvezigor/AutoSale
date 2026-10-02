'use client';

import type { AdminTenantSummary } from '../../../../packages/contracts/src/auth';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { AdminTenantLifecycle } from './admin-tenant-lifecycle';
import { LoadingButton } from './loading-button';

export function AdminDashboard({ tenants, health }: { tenants: AdminTenantSummary[]; health: { status: 'ok' } }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  async function logout() {
    setPending('logout');
    try { if ((await mutatingFetch('/api/auth/logout', { method: 'POST' })).ok) router.refresh(); }
    finally { setPending(null); }
  }
  async function toggle(tenant: AdminTenantSummary) {
    const action = tenant.status === 'ACTIVE' ? 'block' : 'unblock';
    if (tenant.status === 'ACTIVE' && !window.confirm(`Заблокувати організацію «${tenant.tenantName}»?`)) return;
    setPending(tenant.tenantId);
    try { if ((await mutatingFetch(`/api/admin/tenants/${tenant.tenantId}/${action}`, { method: 'POST' })).ok) router.refresh(); }
    finally { setPending(null); }
  }
  return <main className="admin-layout">
    <header className="admin-header"><div><span className="brand">Sales AITO</span><h1>Адміністрування платформи</h1><p>Технічний моніторинг без доступу до даних клієнтів.</p></div><div className="admin-actions"><span className="health-badge">{health.status === 'ok' ? 'Система працює' : 'Потрібна увага'}</span><LoadingButton className="secondary-button" pending={pending === 'logout'} pendingLabel="Вихід…" disabled={pending !== null} onClick={() => void logout()} type="button">Вийти</LoadingButton></div></header>
    <section className="admin-grid">{tenants.map((tenant) => <article className="tenant-card" key={tenant.tenantId}><div><h2>{tenant.tenantName}</h2><span className={`access-badge status-${tenant.status.toLowerCase()}`}>{tenant.status === 'ACTIVE' ? 'Активна' : 'Заблокована'}</span></div><dl><div><dt>Власник</dt><dd>{tenant.ownerEmail ?? 'Не вказано'}</dd></div><div><dt>Користувачі</dt><dd>{tenant.userCount} користувачі</dd></div><div><dt>Замовлення</dt><dd>{tenant.orderCount}</dd></div><div><dt>Створено</dt><dd>{new Date(tenant.createdAt).toLocaleDateString('uk-UA')}</dd></div></dl><div className="tenant-card-actions"><LoadingButton className={tenant.status === 'ACTIVE' ? 'danger-button' : 'primary-button'} pending={pending === tenant.tenantId} pendingLabel="Збереження…" disabled={pending !== null} onClick={() => void toggle(tenant)} type="button">{tenant.status === 'ACTIVE' ? 'Заблокувати організацію' : 'Розблокувати організацію'}</LoadingButton><AdminTenantLifecycle tenantId={tenant.tenantId} tenantName={tenant.tenantName} /></div></article>)}</section>
  </main>;
}
