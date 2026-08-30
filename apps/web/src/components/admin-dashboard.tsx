'use client';

import type { AdminTenantSummary } from '../../../../packages/contracts/src/auth';
import { useRouter } from 'next/navigation';
import { mutatingFetch } from '../auth/csrf-fetch';

export function AdminDashboard({ tenants, health }: { tenants: AdminTenantSummary[]; health: { status: 'ok' } }) {
  const router = useRouter();
  async function logout() { if ((await mutatingFetch('/api/auth/logout', { method: 'POST' })).ok) router.refresh(); }
  async function toggle(tenant: AdminTenantSummary) {
    const action = tenant.status === 'ACTIVE' ? 'block' : 'unblock';
    if (tenant.status === 'ACTIVE' && !window.confirm(`Заблокувати організацію «${tenant.tenantName}»?`)) return;
    if ((await mutatingFetch(`/api/admin/tenants/${tenant.tenantId}/${action}`, { method: 'POST' })).ok) router.refresh();
  }
  return <main className="admin-layout">
    <header className="admin-header"><div><span className="brand">AutoSale</span><h1>Адміністрування платформи</h1><p>Технічний моніторинг без доступу до даних клієнтів.</p></div><div className="admin-actions"><span className="health-badge">{health.status === 'ok' ? 'Система працює' : 'Потрібна увага'}</span><button className="logout-button" onClick={logout} type="button">Вийти</button></div></header>
    <section className="admin-grid">{tenants.map((tenant) => <article className="tenant-card" key={tenant.tenantId}><div><h2>{tenant.tenantName}</h2><span className={`access-badge status-${tenant.status.toLowerCase()}`}>{tenant.status === 'ACTIVE' ? 'Активна' : 'Заблокована'}</span></div><dl><div><dt>Власник</dt><dd>{tenant.ownerEmail ?? 'Не вказано'}</dd></div><div><dt>Користувачі</dt><dd>{tenant.userCount} користувачі</dd></div><div><dt>Замовлення</dt><dd>{tenant.orderCount}</dd></div><div><dt>Створено</dt><dd>{new Date(tenant.createdAt).toLocaleDateString('uk-UA')}</dd></div></dl><button className={tenant.status === 'ACTIVE' ? 'danger-button' : 'primary-button'} onClick={() => toggle(tenant)} type="button">{tenant.status === 'ACTIVE' ? 'Заблокувати організацію' : 'Розблокувати організацію'}</button></article>)}</section>
  </main>;
}
