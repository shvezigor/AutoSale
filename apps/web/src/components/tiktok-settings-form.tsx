'use client';

import {
  tikTokConnectionSummarySchema,
  type TikTokConnectionSummary,
} from '../../../../packages/contracts/src/tiktok';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import { LoadingButton } from './loading-button';

type PendingAction = 'connect' | 'disconnect' | 'cleanup' | null;

export function TikTokSettingsForm({
  initial,
  membershipRole,
  embedded = false,
  onConnectionChange,
}: {
  initial: TikTokConnectionSummary;
  membershipRole: 'OWNER' | 'MANAGER' | null;
  embedded?: boolean;
  onConnectionChange?: (connection: TikTokConnectionSummary) => void;
}) {
  const { formatDate, t } = useI18n();
  const [connection, setConnection] = useState(initial);
  const [pending, setPending] = useState<PendingAction>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const isOwner = membershipRole === 'OWNER';
  const connected = connection.status === 'ACTIVE' || connection.status === 'INBOUND_ONLY';

  function updateConnection(next: TikTokConnectionSummary) {
    setConnection(next);
    onConnectionChange?.(next);
  }

  async function connect() {
    setPending('connect');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/tiktok/authorize', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnPath: '/settings?tab=social' }),
      });
      const payload = await jsonOrNull(response);
      const authorizationUrl = isRecord(payload) ? payload.authorizationUrl : null;
      if (!response.ok || typeof authorizationUrl !== 'string' || !isTrustedTikTokAuthorizationUrl(authorizationUrl)) {
        throw new Error('TIKTOK_AUTHORIZE_FAILED');
      }
      window.location.href = authorizationUrl;
    } catch {
      setFormError(t('tiktokSettings.connectFailed'));
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    if (!window.confirm(t('tiktokSettings.disconnectConfirm'))) return;
    setPending('disconnect');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/tiktok/connection', { method: 'DELETE' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isTikTokSummary(payload)) throw new Error('TIKTOK_DISCONNECT_FAILED');
      updateConnection(payload);
    } catch {
      setFormError(t('tiktokSettings.disconnectFailed'));
    } finally {
      setPending(null);
    }
  }

  async function retryCleanup() {
    setPending('cleanup');
    setFormError(null);
    try {
      const response = await mutatingFetch('/api/integrations/tiktok/cleanup/retry', { method: 'POST' });
      const payload = await jsonOrNull(response);
      if (!response.ok || !isTikTokSummary(payload)) throw new Error('TIKTOK_CLEANUP_FAILED');
      updateConnection(payload);
    } catch {
      setFormError(t('tiktokSettings.cleanupFailed'));
    } finally {
      setPending(null);
    }
  }

  const status = tikTokStatus(connection.status, t);
  return <section className={`settings-card tiktok-connection-card ${embedded ? 'is-embedded' : ''}`} aria-busy={pending !== null || undefined} aria-label={embedded ? 'TikTok' : undefined}>
    {!embedded && <div className="settings-card-heading"><div><h2>TikTok</h2><p>{t('tiktokSettings.description')}</p></div><span className={`connection-status status-${connection.status.toLowerCase()}`}>{status}</span></div>}
    {embedded && <div className="delivery-panel-section-heading"><span>{t('tiktokSettings.connectionSection')}</span><p>{t('tiktokSettings.connectionSectionDescription')}</p></div>}
    <dl className="instagram-connection-details">
      <div><dt>{t('tiktokSettings.account')}</dt><dd>{connection.displayName ?? t('tiktokSettings.notConnected')}</dd></div>
      <div><dt>{t('tiktokSettings.lastCheck')}</dt><dd>{connection.lastVerifiedAt ? formatDate(connection.lastVerifiedAt) : t('tiktokSettings.neverChecked')}</dd></div>
      <div><dt>{t('tiktokSettings.state')}</dt><dd>{status}</dd></div>
      {connected ? <div><dt>{t('tiktokSettings.capability')}</dt><dd>{connection.capabilities?.sendText ? t('tiktokSettings.inboundAndReplies') : t('tiktokSettings.inboundOnly')}</dd></div> : null}
    </dl>
    {membershipRole === 'MANAGER' ? <p className="sheets-hint">{t('tiktokSettings.managerReadonly')}</p> : null}
    {isOwner ? <div className="settings-actions">
      {connection.cleanupStatus === 'PENDING' || connection.cleanupStatus === 'FAILED' ? <LoadingButton className="secondary-button" onClick={() => void retryCleanup()} pending={pending === 'cleanup'} type="button">{t('tiktokSettings.retryCleanup')}</LoadingButton> : null}
      {!connected ? <LoadingButton className="primary-button" onClick={() => void connect()} pending={pending === 'connect'} pendingLabel={t('tiktokSettings.connecting')} type="button">{connection.status === 'REAUTH_REQUIRED' ? t('tiktokSettings.reconnect') : t('tiktokSettings.connect')}</LoadingButton> : null}
      {connected ? <LoadingButton className="danger-button" onClick={() => void disconnect()} pending={pending === 'disconnect'} type="button">{t('tiktokSettings.disconnect')}</LoadingButton> : null}
    </div> : null}
    {formError ? <p className="save-error" role="alert">{formError}</p> : null}
  </section>;
}

export function tikTokStatus(status: TikTokConnectionSummary['status'], t: ReturnType<typeof useI18n>['t']): string {
  return ({
    NOT_CONNECTED: t('tiktokSettings.statusNotConnected'), ACTIVE: t('tiktokSettings.statusActive'),
    INBOUND_ONLY: t('tiktokSettings.statusInboundOnly'), REAUTH_REQUIRED: t('tiktokSettings.statusReauth'),
    ERROR: t('tiktokSettings.statusError'), DISCONNECTED: t('tiktokSettings.statusDisconnected'),
  })[status];
}

function isTrustedTikTokAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'business-api.tiktok.com' || url.hostname === 'ads.tiktok.com');
  } catch { return false; }
}

function isTikTokSummary(value: unknown): value is TikTokConnectionSummary {
  return tikTokConnectionSummarySchema.safeParse(value).success;
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
