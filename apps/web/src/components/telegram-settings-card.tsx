'use client';

import type { TelegramConnectionSummary as ContractTelegramConnectionSummary, TelegramNotificationPreferences } from '../../../../packages/contracts/src/telegram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export type TelegramConnectionSummary = ContractTelegramConnectionSummary;
type PendingAction = 'connect' | 'test' | 'unlink' | null;

export function TelegramSettingsCard({
  initial,
  initialPreferences,
  embedded = false,
  onConnectionChange,
  navigate = (url) => { window.location.href = url; },
}: {
  initial: TelegramConnectionSummary;
  initialPreferences: TelegramNotificationPreferences;
  embedded?: boolean;
  onConnectionChange?: (connection: TelegramConnectionSummary) => void;
  navigate?: (url: string) => void;
}) {
  const [connection, setConnection] = useState(initial);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [pendingPreference, setPendingPreference] = useState<keyof TelegramNotificationPreferences | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const activity = useActivity();
  const toast = useToast();
  const { t, formatDate } = useI18n();
  const connected = connection.personal.connected;

  async function connect() {
    setPendingAction('connect');
    setMessage(null);
    try {
      const response = await activity.run(t('notificationsSettings.openingTelegram'), () => mutatingFetch('/api/integrations/telegram/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'PERSONAL', returnPath: '/settings?tab=notifications' }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isTelegramLink(payload)) throw new Error('link failed');
      navigate(payload.url);
    } catch {
      setMessage({ kind: 'error', text: t('notificationsSettings.connectionOpenFailed') });
      toast.show({ type: 'error', title: t('notificationsSettings.connectFailed') });
    } finally {
      setPendingAction(null);
    }
  }

  async function sendTest() {
    setPendingAction('test');
    setMessage(null);
    try {
      const response = await activity.run(t('notificationsSettings.sendingTestActivity'), () => mutatingFetch('/api/integrations/telegram/test', { method: 'POST' }));
      if (!response.ok) throw new Error('test failed');
      const text = t('notificationsSettings.testQueued');
      setMessage({ kind: 'success', text });
      toast.show({ type: 'success', title: text, message: t('notificationsSettings.checkBotChat') });
    } catch {
      setMessage({ kind: 'error', text: t('notificationsSettings.testFailed') });
      toast.show({ type: 'error', title: t('notificationsSettings.testNotSent') });
    } finally {
      setPendingAction(null);
    }
  }

  async function unlink() {
    setPendingAction('unlink');
    setMessage(null);
    try {
      const response = await activity.run(t('notificationsSettings.disconnectingActivity'), () => mutatingFetch('/api/integrations/telegram/link', { method: 'DELETE' }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUnlinkResponse(payload)) throw new Error('unlink failed');
      const next = { ...connection, personal: { connected: false, displayName: null, username: null, linkedAt: null } };
      setConnection(next);
      onConnectionChange?.(next);
      setConfirmingUnlink(false);
      setMessage({ kind: 'success', text: t('notificationsSettings.disconnected') });
      toast.show({ type: 'success', title: t('notificationsSettings.disconnected') });
    } catch {
      setMessage({ kind: 'error', text: t('notificationsSettings.disconnectFailed') });
      toast.show({ type: 'error', title: t('notificationsSettings.disconnectFailed') });
    } finally {
      setPendingAction(null);
    }
  }

  async function togglePreference(key: keyof TelegramNotificationPreferences) {
    const next = { ...preferences, [key]: !preferences[key] };
    setPendingPreference(key);
    try {
      const response = await mutatingFetch('/api/integrations/telegram/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('preferences failed');
      setPreferences(next);
      toast.show({ type: 'success', title: t('notificationsSettings.preferencesSaved') });
    } catch {
      toast.show({ type: 'error', title: t('notificationsSettings.preferencesSaveFailed') });
    } finally {
      setPendingPreference(null);
    }
  }

  const pending = pendingAction !== null;
  const status = !connection.available ? t('notificationsSettings.unavailable') : connected ? t('notificationsSettings.connected') : t('notificationsSettings.notConnected');

  return <section className={`settings-card telegram-connection-card ${embedded ? 'is-embedded' : ''}`} aria-label="Telegram" aria-busy={pending || undefined}>
    {!embedded && <div className="settings-card-heading">
      <div>
        <h2>Telegram</h2>
        <p>{t('notificationsSettings.description')}</p>
      </div>
      <span className={`connection-status ${connected ? 'status-active' : 'status-not_connected'}`}>{status}</span>
    </div>}

    {!connection.available ? <p className="telegram-connection-copy">{t('notificationsSettings.serviceUnavailable')}</p> : connected ? <>
      <dl className="telegram-connection-details">
        <div><dt>{t('notificationsSettings.account')}</dt><dd>{connection.personal.username ? `@${connection.personal.username}` : connection.personal.displayName ?? t('notificationsSettings.connected')}</dd></div>
        {connection.personal.displayName && connection.personal.username && <div><dt>{t('notificationsSettings.name')}</dt><dd>{connection.personal.displayName}</dd></div>}
        <div><dt>{t('notificationsSettings.connectedAt')}</dt><dd>{connection.personal.linkedAt && !Number.isNaN(new Date(connection.personal.linkedAt).getTime()) ? formatDate(connection.personal.linkedAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('notificationsSettings.justNow')}</dd></div>
      </dl>
      <fieldset className="telegram-alert-preferences" disabled={pendingPreference !== null} aria-busy={pendingPreference !== null || undefined}>
        <legend>{t('notificationsSettings.eventsLegend')}</legend>
        {([
          ['ORDER_NEEDS_REVIEW', t('notificationsSettings.orderNeedsReview')],
          ['ORDER_AUTO_APPROVED', t('notificationsSettings.orderAutoApproved')],
          ['SUPPLIER_DELIVERY_FAILED', t('notificationsSettings.supplierDeliveryFailed')],
        ] as const).map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={preferences[key]} onChange={() => void togglePreference(key)} />
          <span>{label}</span>
        </label>)}
      </fieldset>
      <div className="settings-actions telegram-connection-actions">
        <LoadingButton pending={pendingAction === 'test'} pendingLabel={t('notificationsSettings.sending')} disabled={pending} onClick={() => void sendTest()} type="button">{t('notificationsSettings.sendTest')}</LoadingButton>
        {!confirmingUnlink && <button className="danger-button" disabled={pending} onClick={() => setConfirmingUnlink(true)} type="button">{t('notificationsSettings.disconnect')}</button>}
        {confirmingUnlink && <div className="telegram-unlink-confirmation" role="alert">
          <span>{t('notificationsSettings.disconnectConfirm')}</span>
          <div>
            <button className="secondary-button" disabled={pending} onClick={() => setConfirmingUnlink(false)} type="button">{t('notificationsSettings.cancel')}</button>
            <LoadingButton className="danger-button" pending={pendingAction === 'unlink'} pendingLabel={t('notificationsSettings.disconnecting')} disabled={pending} onClick={() => void unlink()} type="button">{t('notificationsSettings.confirmDisconnect')}</LoadingButton>
          </div>
        </div>}
      </div>
    </> : <>
      <div className="telegram-connection-copy">
        <strong>{t('notificationsSettings.botReady')}</strong>
        <p>{t('notificationsSettings.connectionInstructions')}</p>
      </div>
      <div className="settings-actions telegram-connection-actions">
        <LoadingButton pending={pendingAction === 'connect'} pendingLabel={t('notificationsSettings.opening')} disabled={pending} onClick={() => void connect()} type="button">{t('notificationsSettings.connect')}</LoadingButton>
      </div>
    </>}
    {message && <span className={message.kind === 'error' ? 'save-error' : 'save-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>}
  </section>;
}

function isTelegramLink(value: unknown): value is { url: string; expiresAt: string } {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.expiresAt !== 'string') return false;
  try { return new URL(value.url).origin === 'https://t.me'; }
  catch { return false; }
}

function isUnlinkResponse(value: unknown): value is { disconnected: boolean } {
  return isRecord(value) && typeof value.disconnected === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}
