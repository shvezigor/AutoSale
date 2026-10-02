'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';

import type { RetentionDryRun, TenantLifecycleRequest } from '../../../../packages/contracts/src/tenant-lifecycle';

import { mutatingFetch } from '../auth/csrf-fetch';
import { FormField } from './form-field';
import { clearFieldError, focusFirstInvalid, type FieldErrors } from './form-validation';
import { LoadingButton } from './loading-button';

type ReauthMode = 'delete' | 'download';
type ReauthField = 'tenantName' | 'currentPassword';

export function AdminTenantLifecycle({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [requests, setRequests] = useState<TenantLifecycleRequest[]>([]);
  const [dryRuns, setDryRuns] = useState<RetentionDryRun[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthMode, setReauthMode] = useState<ReauthMode | null>(null);
  const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
  const [tenantNameConfirmation, setTenantNameConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ReauthField>>({});

  async function load() {
    setPending('load');
    setError(null);
    try {
      const [lifecycleResponse, retentionResponse] = await Promise.all([
        fetch('/api/admin/tenant-lifecycle', { cache: 'no-store' }),
        fetch(`/api/admin/retention/dry-runs?tenantId=${encodeURIComponent(tenantId)}`, { cache: 'no-store' }),
      ]);
      if (!lifecycleResponse.ok || !retentionResponse.ok) throw new Error('load_failed');
      const lifecycle = await lifecycleResponse.json() as TenantLifecycleRequest[];
      setRequests(lifecycle.filter((request) => request.tenantId === tenantId));
      setDryRuns(await retentionResponse.json() as RetentionDryRun[]);
      setLoaded(true);
    } catch {
      setError('Не вдалося завантажити керування даними. Спробуйте ще раз.');
    } finally {
      setPending(null);
    }
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) await load();
  }

  async function mutate(key: string, path: string, init: RequestInit) {
    setPending(key);
    setError(null);
    try {
      const response = await mutatingFetch(path, init);
      if (!response.ok) throw new Error('mutation_failed');
      await load();
    } catch {
      setError('Операцію не виконано. Перевірте стан запиту та повторіть спробу.');
    } finally {
      setPending(null);
    }
  }

  async function createExport() {
    if (!window.confirm(`Створити переносимий експорт даних «${tenantName}»?`)) return;
    await mutate('export', `/api/admin/tenants/${tenantId}/lifecycle-exports`, {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ reasonCode: 'CONTROLLER_REQUEST' }),
    });
  }

  async function createRetentionPreview() {
    await mutate('retention', '/api/admin/retention/dry-runs', {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ tenantId }),
    });
  }

  function beginReauth(mode: ReauthMode, requestId?: string) {
    setReauthMode(mode);
    setTargetRequestId(requestId ?? null);
    setTenantNameConfirmation('');
    setCurrentPassword('');
    setFieldErrors({});
    setError(null);
  }

  async function submitReauth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const errors: FieldErrors<ReauthField> = {};
    if (reauthMode === 'delete' && tenantNameConfirmation.trim() !== tenantName) {
      errors.tenantName = 'Введіть повну назву організації без змін.';
    }
    if (!currentPassword) errors.currentPassword = 'Введіть поточний пароль.';
    setFieldErrors(errors);
    const fields = ['tenantName', 'currentPassword'].filter((field) => field in errors) as ReauthField[];
    if (fields.length) {
      focusFirstInvalid(form, fields);
      return;
    }

    const mode = reauthMode;
    if (!mode) return;
    setPending(`reauth:${mode}`);
    setError(null);
    try {
      const reauthResponse = await mutatingFetch('/api/admin/reauth', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          purpose: mode === 'delete' ? 'TENANT_DELETE_REQUEST' : 'TENANT_EXPORT_DOWNLOAD',
        }),
      });
      if (!reauthResponse.ok) throw new Error('reauth_failed');
      const { stepUpToken } = await reauthResponse.json() as { stepUpToken: string };
      if (mode === 'delete') {
        const response = await mutatingFetch(`/api/admin/tenants/${tenantId}/lifecycle-deletions`, {
          method: 'POST', headers: { ...jsonHeaders(), 'x-admin-step-up': stepUpToken },
          body: JSON.stringify({ reasonCode: 'CONTROLLER_REQUEST' }),
        });
        if (!response.ok) throw new Error('delete_prepare_failed');
      } else {
        if (!targetRequestId) throw new Error('request_missing');
        const response = await mutatingFetch(`/api/admin/tenant-lifecycle/${targetRequestId}/download`, {
          method: 'POST', headers: { ...idempotencyHeaders(), 'x-admin-step-up': stepUpToken },
        });
        if (!response.ok) throw new Error('download_failed');
        const { url } = await response.json() as { url: string };
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      }
      setReauthMode(null);
      setCurrentPassword('');
      setTenantNameConfirmation('');
      await load();
    } catch {
      setError('Не вдалося підтвердити операцію. Пароль і введені дані збережено для виправлення.');
    } finally {
      setPending(null);
    }
  }

  return <section className="admin-lifecycle">
    <button className="secondary-button admin-lifecycle-toggle" type="button" aria-expanded={open} onClick={() => void toggleOpen()}>
      {open ? 'Закрити керування даними' : 'Керувати даними'}
    </button>
    {open && <div className="admin-lifecycle-panel">
      <div className="admin-lifecycle-heading">
        <div><h3>Життєвий цикл даних</h3><p>Експорт, підготовка видалення та безпечний retention preview.</p></div>
        <span className="admin-lifecycle-count">{requests.length} запитів</span>
      </div>
      {pending === 'load' && <p role="status">Завантаження…</p>}
      {error && <p className="admin-lifecycle-error" role="alert">{error}</p>}
      {loaded && <>
        <div className="admin-lifecycle-actions">
          <LoadingButton className="secondary-button" pending={pending === 'export'} pendingLabel="Створення…" disabled={pending !== null} onClick={() => void createExport()} type="button">Створити експорт</LoadingButton>
          <button className="danger-button" disabled={pending !== null} onClick={() => beginReauth('delete')} type="button">Підготувати видалення</button>
          <LoadingButton pending={pending === 'retention'} pendingLabel="Підготовка…" disabled={pending !== null} onClick={() => void createRetentionPreview()} type="button">Перевірити строки зберігання</LoadingButton>
        </div>
        {requests.length === 0 ? <p className="admin-lifecycle-empty">Запитів експорту або видалення ще немає.</p> : <ul className="admin-lifecycle-list">
          {requests.map((request) => <li key={request.id}>
            <div><strong>{request.kind === 'EXPORT' ? 'Експорт' : 'Підготовка видалення'}</strong><small>{formatDate(request.requestedAt)} · {statusLabel(request.status)}</small>{request.lastErrorCode && <small>Код помилки: {request.lastErrorCode}</small>}</div>
            <div className="admin-lifecycle-row-actions">
              {request.status === 'EXPORT_READY' && <button className="secondary-button" type="button" onClick={() => beginReauth('download', request.id)}>Завантажити</button>}
              {request.status === 'FAILED' && <LoadingButton className="text-button" pending={pending === `retry:${request.id}`} pendingLabel="Повтор…" disabled={pending !== null} type="button" onClick={() => void mutate(`retry:${request.id}`, `/api/admin/tenant-lifecycle/${request.id}/retry`, { method: 'POST', headers: idempotencyHeaders() })}>Повторити</LoadingButton>}
              {['REQUESTED', 'EXPORTING', 'EXPORT_READY', 'FAILED'].includes(request.status) && <LoadingButton className="text-button" pending={pending === `cancel:${request.id}`} pendingLabel="Скасування…" disabled={pending !== null} type="button" onClick={() => void mutate(`cancel:${request.id}`, `/api/admin/tenant-lifecycle/${request.id}/cancel`, { method: 'POST', headers: idempotencyHeaders() })}>Скасувати</LoadingButton>}
            </div>
          </li>)}
        </ul>}
        <div className="admin-retention-summary">
          <h4>Остання перевірка строків</h4>
          {dryRuns[0]?.summary ? <ul>{dryRuns[0].summary.map((entry) => <li key={entry.category}><span>{retentionLabel(entry.category)}</span><strong>{entry.candidateCount === null ? 'Політику не налаштовано' : `${entry.candidateCount} кандидатів`}</strong></li>)}</ul> : <p>Перевірок ще немає або результат готується.</p>}
        </div>
      </>}
      {reauthMode && <form className="admin-reauth-form" noValidate onSubmit={(event) => void submitReauth(event)}>
        <h4>{reauthMode === 'delete' ? 'Підтвердіть підготовку видалення' : 'Підтвердіть завантаження експорту'}</h4>
        {reauthMode === 'delete' && <FormField id="admin-confirm-tenant-name" label={`Введіть «${tenantName}»`} error={fieldErrors.tenantName} required><input name="tenantName" required value={tenantNameConfirmation} onChange={(event) => { setTenantNameConfirmation(event.target.value); setFieldErrors((current) => clearFieldError(current, 'tenantName')); }} /></FormField>}
        <FormField id="admin-current-password" label="Поточний пароль" error={fieldErrors.currentPassword} required><input name="currentPassword" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setFieldErrors((current) => clearFieldError(current, 'currentPassword')); }} /></FormField>
        <div className="admin-reauth-actions"><button className="secondary-button" type="button" disabled={pending !== null} onClick={() => setReauthMode(null)}>Назад</button><LoadingButton className={reauthMode === 'delete' ? 'danger-button' : 'primary-button'} pending={pending === `reauth:${reauthMode}`} pendingLabel="Підтвердження…" disabled={pending !== null} type="submit">Підтвердити</LoadingButton></div>
      </form>}
    </div>}
  </section>;
}

function idempotencyHeaders(): Record<string, string> {
  return { 'idempotency-key': crypto.randomUUID() };
}

function jsonHeaders(): Record<string, string> {
  return { ...idempotencyHeaders(), 'content-type': 'application/json' };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Kyiv' }).format(new Date(value));
}

function statusLabel(status: TenantLifecycleRequest['status']) {
  return ({ REQUESTED: 'Очікує', EXPORTING: 'Формується', EXPORT_READY: 'Готово', FAILED: 'Помилка', CANCELLED: 'Скасовано' } as const)[status];
}

function retentionLabel(category: string) {
  return ({
    RAW_WEBHOOKS: 'Технічні події провайдерів', USER_NOTIFICATIONS: 'Сповіщення користувачів',
    SECURITY_AUDIT: 'Журнал безпеки', CONVERSATIONS_AND_CUSTOMER_DATA: 'Діалоги й дані клієнтів',
    ORDERS_PAYMENTS_AND_DELIVERY: 'Замовлення, оплати й доставка',
  } as Record<string, string>)[category] ?? category;
}
