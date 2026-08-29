'use client';

import type { InstagramConnectionSummary as ContractInstagramConnectionSummary } from '../../../../packages/contracts/src/instagram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';

export type InstagramConnectionSummary = ContractInstagramConnectionSummary;

type MembershipRole = 'OWNER' | 'MANAGER' | null;
type Message = { kind: 'success' | 'error'; text: string } | null;
type PendingAction = 'connect' | 'disconnect' | 'cleanup' | null;

const META_AUTHORIZATION_ORIGIN = 'https://www.instagram.com';
const CONNECTION_STATUSES = new Set<InstagramConnectionSummary['status']>([
  'NOT_CONNECTED',
  'LEGACY',
  'ACTIVE',
  'REAUTH_REQUIRED',
  'ERROR',
  'DISCONNECTED',
]);

export function InstagramSettingsForm({
  initial,
  membershipRole,
}: {
  initial: InstagramConnectionSummary;
  membershipRole: MembershipRole;
}) {
  const [connection, setConnection] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const isOwner = membershipRole === 'OWNER';
  const pending = pendingAction !== null;
  const cleanupPending = isCleanupPending(connection);
  const actionLabel = connectionActionLabel(connection.status);
  const visibleErrorCode = connection.cleanupErrorCode ?? connection.lastErrorCode;

  async function connect() {
    setPendingAction('connect');
    setMessage(null);
    try {
      const response = await mutatingFetch('/api/integrations/instagram/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnPath: '/settings' }),
      });
      const payload = await jsonOrNull(response);
      const authorizationUrl = isRecord(payload) ? payload.authorizationUrl : null;
      if (!response.ok || typeof authorizationUrl !== 'string' || !isTrustedMetaAuthorizationUrl(authorizationUrl)) {
        throw new Error('connect failed');
      }
      window.location.href = authorizationUrl;
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося розпочати підключення Instagram' });
    } finally {
      setPendingAction(null);
    }
  }

  async function disconnect() {
    setPendingAction('disconnect');
    setMessage(null);
    try {
      const response = await mutatingFetch('/api/integrations/instagram/disconnect', { method: 'POST' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isInstagramConnectionSummary(payload)) throw new Error('disconnect failed');
      setConnection(payload);
      setConfirmingDisconnect(false);
      setMessage({ kind: 'success', text: 'Instagram відключено' });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося відключити Instagram' });
    } finally {
      setPendingAction(null);
    }
  }

  async function retryCleanup() {
    setPendingAction('cleanup');
    setMessage(null);
    try {
      const response = await mutatingFetch('/api/integrations/instagram/cleanup', { method: 'POST' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isInstagramConnectionSummary(payload)) throw new Error('cleanup failed');
      setConnection(payload);
      if (isCleanupPending(payload)) throw new Error('cleanup failed');
      setMessage({ kind: 'success', text: 'Очищення Instagram завершено' });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося очистити підключення Instagram' });
    } finally {
      setPendingAction(null);
    }
  }

  const visibleStatus = pendingAction === 'connect' ? 'Підключення…' : statusLabel(connection.status);

  return <section className="settings-card instagram-connection-card" aria-busy={pending || undefined} aria-labelledby="instagram-connection-title">
    <div className="settings-card-heading">
      <div>
        <h2 id="instagram-connection-title">Instagram</h2>
        <p>Підключіть професійний Instagram-акаунт через Meta, щоб отримувати повідомлення та замовлення.</p>
      </div>
      <span className={`connection-status status-${connection.status.toLowerCase()}`} aria-label={`Статус підключення: ${visibleStatus}`} role={pendingAction === 'connect' ? 'status' : undefined}>
        {visibleStatus}
      </span>
    </div>

    <dl className="instagram-connection-details">
      <div><dt>Акаунт</dt><dd>{connection.username ? `@${connection.username}` : 'Ще не підключено'}</dd></div>
      <div><dt>Остання перевірка</dt><dd>{formatVerificationDate(connection.lastVerifiedAt)}</dd></div>
      {visibleErrorCode && <div><dt>Стан</dt><dd>{safeErrorCode(visibleErrorCode)}</dd></div>}
    </dl>

    {membershipRole === 'MANAGER' && <p className="sheets-hint">Перегляд доступний. Змінювати підключення може власник організації.</p>}

    {isOwner && <div className="settings-actions instagram-connection-actions">
      {actionLabel && !cleanupPending && <button disabled={pending} onClick={() => void connect()} type="button">{actionLabel}</button>}
      {cleanupPending && <button disabled={pending} onClick={() => void retryCleanup()} type="button">Повторити очищення</button>}
      {canDisconnect(connection.status) && !confirmingDisconnect && <button className="danger-button" disabled={pending} onClick={() => setConfirmingDisconnect(true)} type="button">Відключити Instagram</button>}
      {confirmingDisconnect && <div className="instagram-disconnect-confirmation" role="alert">
        <span>Відключити Instagram? Повторне підключення знадобиться для нових повідомлень.</span>
        <div>
          <button className="secondary-button" disabled={pending} onClick={() => setConfirmingDisconnect(false)} type="button">Скасувати</button>
          <button className="danger-button" disabled={pending} onClick={() => void disconnect()} type="button">Так, відключити</button>
        </div>
      </div>}
      {message && <span className={message.kind === 'error' ? 'save-error' : 'save-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>}
    </div>}
  </section>;
}

export function isTrustedMetaAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === META_AUTHORIZATION_ORIGIN && url.protocol === 'https:';
  } catch {
    return false;
  }
}

function connectionActionLabel(status: InstagramConnectionSummary['status']): string | null {
  if (status === 'NOT_CONNECTED' || status === 'DISCONNECTED') return 'Підключити Instagram';
  if (status === 'LEGACY' || status === 'REAUTH_REQUIRED' || status === 'ERROR') return 'Перепідключити Instagram';
  return null;
}

function isCleanupPending(connection: InstagramConnectionSummary): boolean {
  return connection.cleanupStatus === 'PENDING' || connection.cleanupStatus === 'FAILED';
}

function canDisconnect(status: InstagramConnectionSummary['status']): boolean {
  return status === 'ACTIVE' || status === 'LEGACY' || status === 'REAUTH_REQUIRED' || status === 'ERROR';
}

function statusLabel(status: InstagramConnectionSummary['status']): string {
  return {
    NOT_CONNECTED: 'Не підключено',
    LEGACY: 'Потрібне перепідключення',
    ACTIVE: 'Активне',
    REAUTH_REQUIRED: 'Потрібне перепідключення',
    ERROR: 'Помилка підключення',
    DISCONNECTED: 'Відключено',
  }[status];
}

function formatVerificationDate(value: string | null): string {
  if (!value) return 'Ще не перевірялося';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ще не перевірялося';
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date);
}

function safeErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? `Код помилки: ${value}` : 'Потрібна перевірка підключення';
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInstagramConnectionSummary(value: unknown): value is InstagramConnectionSummary {
  if (!isRecord(value) || typeof value.status !== 'string' || !CONNECTION_STATUSES.has(value.status as InstagramConnectionSummary['status'])) return false;
  return ['accountId', 'username', 'tokenExpiresAt', 'lastVerifiedAt', 'lastErrorCode', 'cleanupErrorCode'].every((key) => value[key] === null || typeof value[key] === 'string') &&
    (value.cleanupStatus === 'NONE' || value.cleanupStatus === 'PENDING' || value.cleanupStatus === 'FAILED');
}
