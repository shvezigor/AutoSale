'use client';

import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';
import { localizeApiError } from '../i18n/error-message';

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
  const activity = useActivity();
  const toast = useToast();
  const { t } = useI18n();

  async function connect() {
    setPending(true); setError(null);
    try {
      const response = await activity.run(t('googleSettings.connectingActivity'), () => mutatingFetch('/api/integrations/google/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnPath: '/settings?tab=google' }),
      }));
      const body = await response.json() as { authorizationUrl?: string; message?: string; code?: string };
      if (!response.ok || !body.authorizationUrl) throw body;
      navigate(body.authorizationUrl);
    } catch (reason) {
      const text = localizeApiError(reason, t); setError(text); toast.show({ type: 'error', title: t('googleSettings.connectFailed'), message: text });
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true); setError(null);
    try {
      const response = await activity.run(t('googleSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/google/disconnect', { method: 'POST' }));
      const body = await response.json() as { status?: string; message?: string; code?: string };
      if (!response.ok) throw body;
      setConnection({ ...connection, status: body.status ?? 'DISCONNECTING', email: null, grantedScopes: [] });
      toast.show({ type: 'success', title: t('googleSettings.disconnectingToast') });
    } catch (reason) {
      const text = localizeApiError(reason, t); setError(text); toast.show({ type: 'error', title: t('googleSettings.disconnectFailed'), message: text });
    } finally {
      setPending(false);
    }
  }

  const connectAction = connection.status === 'NOT_CONNECTED' || connection.status === 'DISCONNECTED'
    ? t('googleSettings.connect')
    : connection.status === 'REAUTHORIZATION_REQUIRED' || connection.status === 'ERROR'
      ? t('googleSettings.reconnect')
      : null;

  return <section className="settings-card google-connection-card" aria-labelledby="google-connection-title">
    <div className="settings-card-heading">
      <div><h2 id="google-connection-title">{t('googleSettings.accountTitle')}</h2><p>{connection.status === 'ACTIVE' ? t('googleSettings.connected') : statusDescription(connection.status, t)}</p></div>
      <span className={`connection-status status-${connection.status.toLowerCase()}`}>{statusLabel(connection.status, t)}</span>
    </div>
    {owner && connection.email && <div className="google-account-summary"><span>{t('googleSettings.connectedAccount')}</span><strong>{connection.email}</strong></div>}
    {owner && <div className="settings-actions">
      {connectAction && <LoadingButton type="button" pending={pending} pendingLabel={t('googleSettings.connecting')} onClick={() => void connect()}>{connectAction}</LoadingButton>}
      {connection.status === 'ACTIVE' && <LoadingButton type="button" className="text-button" pending={pending} pendingLabel={t('googleSettings.disconnecting')} onClick={() => void disconnect()}>{t('googleSettings.disconnect')}</LoadingButton>}
      {connection.status === 'DISCONNECTING' && <span>{t('googleSettings.safeDisconnect')}</span>}
    </div>}
    {error && <p className="save-error" role="alert">{error}</p>}
  </section>;
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']) {
  return ({ NOT_CONNECTED: t('googleSettings.notConnected'), ACTIVE: t('googleSettings.active'), REAUTHORIZATION_REQUIRED: t('googleSettings.signInRequired'), DISCONNECTING: t('googleSettings.disconnectStatus'), ERROR: t('googleSettings.error'), DISCONNECTED: t('googleSettings.disconnected') } as Record<string, string>)[status] ?? status;
}

function statusDescription(status: string, t: ReturnType<typeof useI18n>['t']) {
  return ({
    NOT_CONNECTED: t('googleSettings.connectDescription'), REAUTHORIZATION_REQUIRED: t('googleSettings.reconnectDescription'), DISCONNECTING: t('googleSettings.disconnectingDescription'), ERROR: t('googleSettings.errorDescription'), DISCONNECTED: t('googleSettings.disconnectedDescription'),
  } as Record<string, string>)[status] ?? t('googleSettings.checkStatus');
}
