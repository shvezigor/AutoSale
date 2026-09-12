'use client';

import type { DeliveryConnectionSummary } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type MeestSettingsSummary = {
  enabled: boolean;
  connection: DeliveryConnectionSummary | null;
};

export function MeestSettingsCard({ initial, role }: { initial: MeestSettingsSummary; role: 'OWNER' | 'MANAGER' }) {
  const [connection, setConnection] = useState(initial.connection);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [clientUid, setClientUid] = useState('');
  const [pending, setPending] = useState<'connect' | 'disconnect' | null>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';

  async function connect(): Promise<void> {
    setPending('connect');
    try {
      const response = await activity.run('Підключаємо Meest', () => mutatingFetch('/api/integrations/delivery/meest', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password, clientUid: clientUid.trim() }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isMeestConnection(payload)) throw new Error('connection failed');
      setConnection(payload);
      setLogin('');
      setPassword('');
      setClientUid('');
      toast.show({ type: 'success', title: 'Meest підключено' });
    } catch {
      setPassword('');
      toast.show({ type: 'error', title: 'Не вдалося підключити Meest', message: 'Перевірте логін, пароль і ClientUID з договору Meest.' });
    } finally {
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    const approved = await confirm({
      title: 'Відключити Meest?',
      description: 'Нові відправлення Meest не створюватимуться, а історія залишиться в AutoSale.',
      confirmLabel: 'Так, відключити',
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run('Відключаємо Meest', () => mutatingFetch('/api/integrations/delivery/meest', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      toast.show({ type: 'success', title: 'Meest відключено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося відключити Meest' });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return null;

  return <section className="settings-card delivery-settings-card" aria-labelledby="meest-settings-title" aria-busy={pending !== null || undefined}>
    <div className="settings-card-heading">
      <div><h2 id="meest-settings-title">Meest</h2><p>Другий перевізник для доставки замовлень із AutoSale.</p></div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(connection?.status)}</span>
    </div>
    {connection?.accountLabel && <div className="delivery-account-summary"><span>Обліковий запис</span><strong>{connection.accountLabel}</strong></div>}
    {!owner
      ? <p className="delivery-readonly-note">Підключенням перевізника керує власник робочого простору.</p>
      : <>
          <div className="delivery-connect-guide">
            <div><strong>{active ? 'Потрібно замінити доступ?' : 'Потрібен договір із Meest'}</strong><span>Meest надає логін, пароль і ClientUID після оформлення договору.</span></div>
            <a className="secondary-button" href="https://wiki.meest-group.com/uk/api/api-eng" target="_blank" rel="noreferrer">Документація Meest API</a>
          </div>
          <div className="meest-connect-grid">
            <label><span>Логін Meest API</span><input aria-label="Логін Meest API" autoComplete="off" value={login} onChange={(event) => setLogin(event.target.value)} /></label>
            <label><span>Пароль Meest API</span><input aria-label="Пароль Meest API" autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label><span>ClientUID</span><input aria-label="ClientUID" autoComplete="off" value={clientUid} onChange={(event) => setClientUid(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label>
          </div>
          <p className="delivery-key-note">Дані перевіряються через HTTPS і зберігаються лише в зашифрованому вигляді.</p>
          <div className="settings-actions delivery-settings-actions">
            <LoadingButton type="button" pending={pending === 'connect'} pendingLabel="Підключаємо…" disabled={pending !== null || !login.trim() || !password || !isUuid(clientUid.trim())} onClick={() => void connect()}>{active ? 'Замінити доступ' : 'Підключити Meest'}</LoadingButton>
            {active && <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel="Відключаємо…" disabled={pending !== null} onClick={() => void disconnect()}>Відключити Meest</LoadingButton>}
          </div>
        </>}
  </section>;
}

function statusLabel(status: DeliveryConnectionSummary['status'] | undefined): string {
  if (!status) return 'Не підключено';
  return ({ ACTIVE: 'Активне', NEEDS_ATTENTION: 'Потрібна увага', DISCONNECTED: 'Відключено' } as const)[status];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isMeestConnection(value: unknown): value is DeliveryConnectionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'MEEST'
    && (record.status === 'ACTIVE' || record.status === 'NEEDS_ATTENTION' || record.status === 'DISCONNECTED')
    && (typeof record.accountLabel === 'string' || record.accountLabel === null)
    && (typeof record.lastVerifiedAt === 'string' || record.lastVerifiedAt === null)
    && (typeof record.lastErrorCode === 'string' || record.lastErrorCode === null)
    && record.senderProfile === null;
}
