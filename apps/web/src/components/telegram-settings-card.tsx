'use client';

import type { TelegramConnectionSummary as ContractTelegramConnectionSummary, TelegramNotificationPreferences } from '../../../../packages/contracts/src/telegram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type TelegramConnectionSummary = ContractTelegramConnectionSummary;
type PendingAction = 'connect' | 'test' | 'unlink' | null;

export function TelegramSettingsCard({
  initial,
  initialPreferences,
  navigate = (url) => { window.location.href = url; },
}: {
  initial: TelegramConnectionSummary;
  initialPreferences: TelegramNotificationPreferences;
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
  const connected = connection.personal.connected;

  async function connect() {
    setPendingAction('connect');
    setMessage(null);
    try {
      const response = await activity.run('Відкриваємо Telegram', () => mutatingFetch('/api/integrations/telegram/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'PERSONAL', returnPath: '/settings?tab=telegram' }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isTelegramLink(payload)) throw new Error('link failed');
      navigate(payload.url);
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося відкрити підключення Telegram' });
      toast.show({ type: 'error', title: 'Не вдалося підключити Telegram' });
    } finally {
      setPendingAction(null);
    }
  }

  async function sendTest() {
    setPendingAction('test');
    setMessage(null);
    try {
      const response = await activity.run('Надсилаємо тестове сповіщення', () => mutatingFetch('/api/integrations/telegram/test', { method: 'POST' }));
      if (!response.ok) throw new Error('test failed');
      const text = 'Тестове сповіщення поставлено в чергу';
      setMessage({ kind: 'success', text });
      toast.show({ type: 'success', title: text, message: 'Перевірте особистий чат із ботом AutoSale.' });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося надіслати тестове сповіщення' });
      toast.show({ type: 'error', title: 'Тестове сповіщення не надіслано' });
    } finally {
      setPendingAction(null);
    }
  }

  async function unlink() {
    setPendingAction('unlink');
    setMessage(null);
    try {
      const response = await activity.run('Відключаємо Telegram', () => mutatingFetch('/api/integrations/telegram/link', { method: 'DELETE' }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUnlinkResponse(payload)) throw new Error('unlink failed');
      setConnection({ ...connection, personal: { connected: false, displayName: null, username: null, linkedAt: null } });
      setConfirmingUnlink(false);
      setMessage({ kind: 'success', text: 'Telegram відключено' });
      toast.show({ type: 'success', title: 'Telegram відключено' });
    } catch {
      setMessage({ kind: 'error', text: 'Не вдалося відключити Telegram' });
      toast.show({ type: 'error', title: 'Не вдалося відключити Telegram' });
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
      toast.show({ type: 'success', title: 'Налаштування сповіщень збережено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося зберегти налаштування сповіщень' });
    } finally {
      setPendingPreference(null);
    }
  }

  const pending = pendingAction !== null;
  const status = !connection.available ? 'Недоступно' : connected ? 'Підключено' : 'Не підключено';

  return <section className="settings-card telegram-connection-card" aria-label="Telegram" aria-busy={pending || undefined}>
    <div className="settings-card-heading">
      <div>
        <h2>Telegram</h2>
        <p>Отримуйте особисті сповіщення AutoSale у Telegram.</p>
      </div>
      <span className={`connection-status ${connected ? 'status-active' : 'status-not_connected'}`}>{status}</span>
    </div>

    {!connection.available ? <p className="telegram-connection-copy">Telegram ще не активовано для AutoSale. Зверніться до адміністратора сервісу.</p> : connected ? <>
      <dl className="telegram-connection-details">
        <div><dt>Акаунт</dt><dd>{connection.personal.username ? `@${connection.personal.username}` : connection.personal.displayName ?? 'Підключено'}</dd></div>
        {connection.personal.displayName && connection.personal.username && <div><dt>Ім’я</dt><dd>{connection.personal.displayName}</dd></div>}
        <div><dt>Підключено</dt><dd>{formatDate(connection.personal.linkedAt)}</dd></div>
      </dl>
      <fieldset className="telegram-alert-preferences" disabled={pendingPreference !== null} aria-busy={pendingPreference !== null || undefined}>
        <legend>Які події надсилати</legend>
        {([
          ['ORDER_NEEDS_REVIEW', 'Замовлення потребує перевірки'],
          ['ORDER_AUTO_APPROVED', 'Замовлення створено автоматично'],
          ['SUPPLIER_DELIVERY_FAILED', 'Не вдалося надіслати постачальнику'],
        ] as const).map(([key, label]) => <label key={key}>
          <input type="checkbox" checked={preferences[key]} onChange={() => void togglePreference(key)} />
          <span>{label}</span>
        </label>)}
      </fieldset>
      <div className="settings-actions telegram-connection-actions">
        <LoadingButton pending={pendingAction === 'test'} pendingLabel="Надсилаємо…" disabled={pending} onClick={() => void sendTest()} type="button">Надіслати тест</LoadingButton>
        {!confirmingUnlink && <button className="danger-button" disabled={pending} onClick={() => setConfirmingUnlink(true)} type="button">Відключити</button>}
        {confirmingUnlink && <div className="telegram-unlink-confirmation" role="alert">
          <span>Відключити Telegram? Особисті сповіщення перестануть надходити.</span>
          <div>
            <button className="secondary-button" disabled={pending} onClick={() => setConfirmingUnlink(false)} type="button">Скасувати</button>
            <LoadingButton className="danger-button" pending={pendingAction === 'unlink'} pendingLabel="Відключаємо…" disabled={pending} onClick={() => void unlink()} type="button">Так, відключити</LoadingButton>
          </div>
        </div>}
      </div>
    </> : <>
      <div className="telegram-connection-copy">
        <strong>Бот AutoSale вже налаштований</strong>
        <p>Натисніть одну кнопку, відкрийте Telegram і виберіть Start. Паролі та технічні ключі вводити не потрібно.</p>
      </div>
      <div className="settings-actions telegram-connection-actions">
        <LoadingButton pending={pendingAction === 'connect'} pendingLabel="Відкриваємо…" disabled={pending} onClick={() => void connect()} type="button">Підключити Telegram</LoadingButton>
      </div>
    </>}
    {message && <span className={message.kind === 'error' ? 'save-error' : 'save-success'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</span>}
  </section>;
}

function formatDate(value: string | null): string {
  if (!value) return 'Щойно';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Щойно';
  return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
