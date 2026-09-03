'use client';

import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';

export type GoogleConnectionSummary = {
  status: string;
  email: string | null;
  grantedScopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
};

export function GoogleConnectionSettings({
  initial,
  role,
  navigate = (url) => window.location.assign(url),
}: {
  initial: GoogleConnectionSummary;
  role: 'OWNER' | 'MANAGER';
  navigate?: (url: string) => void;
}) {
  const [connection, setConnection] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = role === 'OWNER';

  async function connect() {
    setPending(true); setError(null);
    try {
      const response = await mutatingFetch('/api/integrations/google/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnPath: '/settings#google' }),
      });
      const body = await response.json() as { authorizationUrl?: string; message?: string };
      if (!response.ok || !body.authorizationUrl) throw new Error(body.message ?? 'Не вдалося розпочати підключення Google');
      navigate(body.authorizationUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося підключити Google');
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true); setError(null);
    try {
      const response = await mutatingFetch('/api/integrations/google/disconnect', { method: 'POST' });
      const body = await response.json() as { status?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося відключити Google');
      setConnection({ ...connection, status: body.status ?? 'DISCONNECTING', email: null, grantedScopes: [] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не вдалося відключити Google');
    } finally {
      setPending(false);
    }
  }

  const connectAction = connection.status === 'NOT_CONNECTED' || connection.status === 'DISCONNECTED'
    ? 'Підключити Google'
    : connection.status === 'REAUTHORIZATION_REQUIRED' || connection.status === 'ERROR'
      ? 'Підключити повторно'
      : null;

  return <section className="settings-card google-connection-card" aria-labelledby="google-connection-title">
    <div className="settings-card-heading">
      <div><h2 id="google-connection-title">Google-акаунт</h2><p>{connection.status === 'ACTIVE' ? 'Google підключено' : statusDescription(connection.status)}</p></div>
      <span className={`connection-status status-${connection.status.toLowerCase()}`}>{statusLabel(connection.status)}</span>
    </div>
    {owner && connection.email && <div className="google-account-summary"><span>Підключений акаунт</span><strong>{connection.email}</strong></div>}
    {owner && <div className="settings-actions">
      {connectAction && <button type="button" disabled={pending} onClick={() => void connect()}>{connectAction}</button>}
      {connection.status === 'ACTIVE' && <button type="button" className="text-button" disabled={pending} onClick={() => void disconnect()}>Відключити Google</button>}
      {connection.status === 'DISCONNECTING' && <span>Завершуємо безпечне відключення…</span>}
    </div>}
    {error && <p className="save-error" role="alert">{error}</p>}
  </section>;
}

function statusLabel(status: string) {
  return ({ NOT_CONNECTED: 'Не підключено', ACTIVE: 'Активне', REAUTHORIZATION_REQUIRED: 'Потрібен вхід', DISCONNECTING: 'Відключення', ERROR: 'Помилка', DISCONNECTED: 'Відключено' } as Record<string, string>)[status] ?? status;
}

function statusDescription(status: string) {
  return ({
    NOT_CONNECTED: 'Підключіть Google, щоб обирати приватні таблиці.',
    REAUTHORIZATION_REQUIRED: 'Google відкликав доступ. Підключіть акаунт повторно.',
    DISCONNECTING: 'Нові синхронізації вже зупинені.',
    ERROR: 'Підключення потребує вашої уваги.',
    DISCONNECTED: 'Google-акаунт відключено.',
  } as Record<string, string>)[status] ?? 'Перевірте стан підключення.';
}
