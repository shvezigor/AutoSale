'use client';

import type { UkrposhtaConnectionSummary } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type UkrposhtaSettingsSummary = {
  enabled: boolean;
  connection: UkrposhtaConnectionSummary | null;
};

export function UkrposhtaSettingsCard({ initial, role }: { initial: UkrposhtaSettingsSummary; role: 'OWNER' | 'MANAGER' }) {
  const [connection, setConnection] = useState(initial.connection);
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>(initial.connection?.environment ?? 'SANDBOX');
  const [ecomBearer, setEcomBearer] = useState('');
  const [counterpartyToken, setCounterpartyToken] = useState('');
  const [trackingBearer, setTrackingBearer] = useState('');
  const [counterpartyUuid, setCounterpartyUuid] = useState('');
  const [pending, setPending] = useState<'connect' | 'disconnect' | null>(null);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';

  function clearSecrets(): void {
    setEcomBearer('');
    setCounterpartyToken('');
    setTrackingBearer('');
    setCounterpartyUuid('');
  }

  async function connect(): Promise<void> {
    setPending('connect');
    try {
      const response = await activity.run('Підключаємо Укрпошту', () => mutatingFetch('/api/integrations/delivery/ukrposhta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ environment, ecomBearer: ecomBearer.trim(), counterpartyToken: counterpartyToken.trim(), trackingBearer: trackingBearer.trim(), counterpartyUuid: counterpartyUuid.trim() }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUkrposhtaConnection(payload)) throw new Error('connection failed');
      setConnection(payload);
      setEnvironment(payload.environment ?? 'SANDBOX');
      toast.show({ type: 'success', title: 'Укрпошту підключено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося підключити Укрпошту', message: 'Перевірте реквізити з договору Укрпошти.' });
    } finally {
      clearSecrets();
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    const approved = await confirm({
      title: 'Відключити Укрпошту?',
      description: 'Нові відправлення Укрпошти не створюватимуться, а історія залишиться в AutoSale.',
      confirmLabel: 'Так, відключити',
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run('Відключаємо Укрпошту', () => mutatingFetch('/api/integrations/delivery/ukrposhta', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      toast.show({ type: 'success', title: 'Укрпошту відключено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося відключити Укрпошту' });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return null;

  return <section className="settings-card delivery-settings-card" aria-labelledby="ukrposhta-settings-title" aria-busy={pending !== null || undefined}>
    <div className="settings-card-heading">
      <div><h2 id="ukrposhta-settings-title">Укрпошта</h2><p>Підключення для бізнес-відправлень через API.</p></div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(connection?.status)}</span>
    </div>
    {connection?.accountLabel && <div className="delivery-account-summary"><span>Обліковий запис</span><strong>{connection.accountLabel}</strong></div>}
    {connection?.environment && <div className="delivery-account-summary"><span>Середовище</span><strong>{environmentLabel(connection.environment)}</strong></div>}
    {!owner
      ? <p className="delivery-readonly-note">Підключенням перевізника керує власник робочого простору.</p>
      : <>
          <div className="delivery-connect-guide">
            <div><strong>{active ? 'Потрібно замінити доступ?' : 'Потрібен договір з Укрпоштою'}</strong><span>Реквізити eCom, контрагента та StatusTracking Укрпошта надає для бізнес-відправлень за договором.</span></div>
            <a className="secondary-button" href="https://dev.ukrposhta.ua/" target="_blank" rel="noreferrer">Документація API</a>
          </div>
          <div className="ukrposhta-connect-grid">
            <label><span>Середовище Укрпошти</span><select aria-label="Середовище Укрпошти" value={environment} onChange={(event) => setEnvironment(event.target.value as 'SANDBOX' | 'PRODUCTION')}><option value="SANDBOX">Тестове середовище</option><option value="PRODUCTION">Бойове середовище</option></select></label>
            <label><span>eCom bearer</span><input aria-label="eCom bearer" autoComplete="new-password" type="password" value={ecomBearer} onChange={(event) => setEcomBearer(event.target.value)} /></label>
            <label><span>Токен контрагента</span><input aria-label="Токен контрагента" autoComplete="new-password" type="password" value={counterpartyToken} onChange={(event) => setCounterpartyToken(event.target.value)} /></label>
            <label><span>StatusTracking bearer</span><input aria-label="StatusTracking bearer" autoComplete="new-password" type="password" value={trackingBearer} onChange={(event) => setTrackingBearer(event.target.value)} /></label>
            <label><span>UUID контрагента</span><input aria-label="UUID контрагента" autoComplete="off" value={counterpartyUuid} onChange={(event) => setCounterpartyUuid(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label>
          </div>
          {environment === 'PRODUCTION' && <p className="ukrposhta-production-warning"><strong>Бойове середовище</strong> Використовуйте лише бойові реквізити Укрпошти. Тестові UUID і ключі тут не працюватимуть.</p>}
          <p className="delivery-key-note">API-відправлення не з’являються в Особистому кабінеті Укрпошти. AutoSale перевіряє реквізити через HTTPS і зберігає їх лише зашифрованими.</p>
          <div className="settings-actions delivery-settings-actions">
            <LoadingButton type="button" pending={pending === 'connect'} pendingLabel="Підключаємо…" disabled={pending !== null || !ready(ecomBearer, counterpartyToken, trackingBearer, counterpartyUuid)} onClick={() => void connect()}>{active ? 'Замінити доступ' : 'Підключити Укрпошту'}</LoadingButton>
            {active && <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel="Відключаємо…" disabled={pending !== null} onClick={() => void disconnect()}>Відключити Укрпошту</LoadingButton>}
          </div>
        </>}
  </section>;
}

function ready(ecomBearer: string, counterpartyToken: string, trackingBearer: string, counterpartyUuid: string): boolean {
  return ecomBearer.trim().length >= 8 && counterpartyToken.trim().length >= 8 && trackingBearer.trim().length >= 8 && isUuid(counterpartyUuid.trim());
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function statusLabel(status: UkrposhtaConnectionSummary['status'] | undefined): string {
  if (!status) return 'Не підключено';
  return ({ ACTIVE: 'Активне', NEEDS_ATTENTION: 'Потрібна увага', DISCONNECTED: 'Відключено' } as const)[status];
}

function environmentLabel(environment: NonNullable<UkrposhtaConnectionSummary['environment']>): string {
  return environment === 'SANDBOX' ? 'Тестове середовище' : 'Бойове середовище';
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isUkrposhtaConnection(value: unknown): value is UkrposhtaConnectionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'UKRPOSHTA'
    && (record.status === 'ACTIVE' || record.status === 'NEEDS_ATTENTION' || record.status === 'DISCONNECTED')
    && (typeof record.accountLabel === 'string' || record.accountLabel === null)
    && (typeof record.lastVerifiedAt === 'string' || record.lastVerifiedAt === null)
    && (typeof record.lastErrorCode === 'string' || record.lastErrorCode === null)
    && (record.environment === 'SANDBOX' || record.environment === 'PRODUCTION' || record.environment === null);
}
