'use client';

import type { AdminTenantSummary } from '../../../../packages/contracts/src/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useI18n } from '../i18n/i18n-provider';
import { getAdminCopy } from './admin-copy';

type SortKey = 'name' | 'users' | 'orders' | 'date';

export function AdminTenantsTable({ tenants }: { tenants: AdminTenantSummary[] }) {
  const router = useRouter();
  const { locale, formatDate, formatNumber } = useI18n();
  const text = getAdminCopy(locale).clients;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | AdminTenantSummary['status']>('ALL');
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'date', direction: 'desc' });
  const rows = useMemo(() => tenants
    .filter((tenant) => status === 'ALL' || tenant.status === status)
    .filter((tenant) => `${tenant.tenantName} ${tenant.ownerEmail ?? ''}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))
    .sort((left, right) => compareTenants(left, right, sort.key, locale) * (sort.direction === 'asc' ? 1 : -1)), [locale, query, sort, status, tenants]);

  function updateSort(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  }
  function open(tenantId: string) { router.push(`/admin/tenants/${tenantId}`); }

  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="admin-eyebrow">{text.eyebrow}</span><h1>{text.title}</h1><p>{text.description}</p></div><strong className="admin-result-count">{text.total.replace('{count}', formatNumber(rows.length))}</strong></header>
    <div className="admin-table-toolbar"><label><span className="sr-only">{text.searchPlaceholder}</span><input type="search" value={query} placeholder={text.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></label><label><span>{text.statusLabel}</span><select aria-label={text.statusLabel} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="ALL">{text.allStatuses}</option><option value="ACTIVE">{text.active}</option><option value="BLOCKED">{text.blocked}</option></select></label></div>
    <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr>
      <th>{text.columns.number}</th><SortableHeading label={text.columns.organization} action={text.sortName} active={sort.key === 'name'} direction={sort.direction} onClick={() => updateSort('name')} /><th>{text.columns.owner}</th><SortableHeading label={text.columns.users} action={text.sortUsers} active={sort.key === 'users'} direction={sort.direction} onClick={() => updateSort('users')} /><SortableHeading label={text.columns.orders} action={text.sortOrders} active={sort.key === 'orders'} direction={sort.direction} onClick={() => updateSort('orders')} /><th>{text.columns.status}</th><SortableHeading label={text.columns.created} action={text.sortDate} active={sort.key === 'date'} direction={sort.direction} onClick={() => updateSort('date')} /><th><span className="sr-only">{text.columns.action}</span></th>
    </tr></thead><tbody>{rows.length === 0 ? <tr><td className="admin-table-empty" colSpan={8}>{text.empty}</td></tr> : rows.map((tenant, index) => <tr className="admin-clickable-row" key={tenant.tenantId} tabIndex={0} onClick={() => open(tenant.tenantId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(tenant.tenantId); } }}>
      <td data-label={text.columns.number}>{index + 1}</td><td data-label={text.columns.organization}><strong>{tenant.tenantName}</strong><small>{tenant.tenantId.slice(0, 8).toUpperCase()}</small></td><td data-label={text.columns.owner}>{tenant.ownerEmail ?? '—'}</td><td data-label={text.columns.users}>{formatNumber(tenant.userCount)}</td><td data-label={text.columns.orders}>{formatNumber(tenant.orderCount)}</td><td data-label={text.columns.status}><span className={`admin-access-status status-${tenant.status.toLowerCase()}`}>{tenant.status === 'ACTIVE' ? text.active : text.blocked}</span></td><td data-label={text.columns.created}>{formatDate(tenant.createdAt, { dateStyle: 'medium' })}</td><td data-label={text.columns.action}><Link className="secondary-button" href={`/admin/tenants/${tenant.tenantId}`} onClick={(event) => event.stopPropagation()}>{text.view}</Link></td>
    </tr>)}</tbody></table></div>
  </div>;
}

function SortableHeading({ label, action, active, direction, onClick }: { label: string; action: string; active: boolean; direction: 'asc' | 'desc'; onClick(): void }) {
  return <th aria-sort={active ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="admin-sort-button" type="button" aria-label={action} onClick={onClick}>{label}<span aria-hidden="true">{active ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>;
}

function compareTenants(left: AdminTenantSummary, right: AdminTenantSummary, key: SortKey, locale: string) {
  if (key === 'name') return left.tenantName.localeCompare(right.tenantName, locale);
  if (key === 'users') return left.userCount - right.userCount;
  if (key === 'orders') return left.orderCount - right.orderCount;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}
