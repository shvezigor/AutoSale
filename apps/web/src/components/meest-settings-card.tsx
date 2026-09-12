'use client';

import type { DeliveryLocation, MeestConnectionSummary, MeestSenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type MeestSettingsSummary = {
  enabled: boolean;
  connection: MeestConnectionSummary | null;
};

const emptyProfile: MeestSenderProfileInput = {
  senderName: '', senderPhone: '',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  suggestCustomerNotification: true,
  customerNotificationTemplate: '{company}: відправлення створено. ТТН {trackingNumber}',
};

export function MeestSettingsCard({ initial, role }: { initial: MeestSettingsSummary; role: 'OWNER' | 'MANAGER' }) {
  const [connection, setConnection] = useState(initial.connection);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [clientUid, setClientUid] = useState('');
  const [profile, setProfile] = useState<MeestSenderProfileInput>(initial.connection?.senderProfile ?? emptyProfile);
  const [city, setCity] = useState<DeliveryLocation | null>(null);
  const [pending, setPending] = useState<'connect' | 'disconnect' | 'profile' | null>(null);
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
      setProfile(payload.senderProfile ?? emptyProfile);
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

  async function saveProfile(): Promise<void> {
    setPending('profile');
    try {
      const response = await activity.run('Зберігаємо відправника Meest', () => mutatingFetch('/api/integrations/delivery/meest/sender-profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isMeestSenderProfile(payload)) throw new Error('profile failed');
      setProfile(payload);
      setConnection((current) => current ? { ...current, senderProfile: payload } : current);
      toast.show({ type: 'success', title: 'Відправника Meest збережено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося зберегти відправника Meest' });
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
          {active && <fieldset className="delivery-sender-form" disabled={pending !== null}>
            <legend>Відправник і точка відправлення</legend>
            <div className="meest-connect-grid">
              <label><span>Назва відправника Meest</span><input aria-label="Назва відправника Meest" value={profile.senderName} onChange={(event) => setProfile((current) => ({ ...current, senderName: event.target.value }))} /></label>
              <label><span>Телефон відправника Meest</span><input aria-label="Телефон відправника Meest" inputMode="tel" placeholder="+380501112233" value={profile.senderPhone} onChange={(event) => setProfile((current) => ({ ...current, senderPhone: event.target.value }))} /></label>
            </div>
            <div className="delivery-origin-grid">
              <DeliveryLocationPicker provider="MEEST" label="Місто відправлення Meest" type="CITY" value={city} onSelect={(value) => setCity(value)} />
              <DeliveryLocationPicker
                provider="MEEST"
                label="Відділення відправлення Meest"
                type="BRANCH"
                {...(city?.ref || profile.origin.cityRef ? { cityRef: city?.ref ?? profile.origin.cityRef } : {})}
                value={profile.origin.locationRef ? { ref: profile.origin.locationRef, provider: 'MEEST', type: profile.origin.type, label: profile.origin.label, cityRef: profile.origin.cityRef } : null}
                onSelect={(value) => setProfile((current) => ({
                  ...current,
                  origin: value ? { type: value.type === 'PARCEL_LOCKER' ? 'PARCEL_LOCKER' : 'BRANCH', cityRef: value.cityRef!, locationRef: value.ref, label: value.label } : { type: 'BRANCH', cityRef: city?.ref ?? '', locationRef: '', label: '' },
                }))}
              />
            </div>
            <div className="delivery-parcel-grid">
              <NumberField label="Вага, кг" value={profile.defaultParcel.weightKg} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, weightKg: value } }))} />
              <NumberField label="Довжина, см" value={profile.defaultParcel.lengthCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, lengthCm: value } }))} />
              <NumberField label="Ширина, см" value={profile.defaultParcel.widthCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, widthCm: value } }))} />
              <NumberField label="Висота, см" value={profile.defaultParcel.heightCm} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, heightCm: value } }))} />
            </div>
            <label><span>Хто оплачує доставку</span><select value={profile.payer} onChange={(event) => setProfile((current) => ({ ...current, payer: event.target.value as MeestSenderProfileInput['payer'] }))}><option value="SENDER">Відправник</option><option value="RECIPIENT">Одержувач</option></select></label>
            <label className="delivery-checkbox"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile((current) => ({ ...current, suggestCustomerNotification: event.target.checked }))} /><span>Пропонувати повідомлення клієнту після створення ТТН</span></label>
            <label><span>Шаблон повідомлення</span><textarea value={profile.customerNotificationTemplate} onChange={(event) => setProfile((current) => ({ ...current, customerNotificationTemplate: event.target.value }))} /></label>
            <div className="settings-actions delivery-settings-actions"><LoadingButton type="button" pending={pending === 'profile'} pendingLabel="Зберігаємо…" disabled={pending !== null || !validProfile(profile)} onClick={() => void saveProfile()}>Зберегти відправника</LoadingButton></div>
          </fieldset>}
        </>}
  </section>;
}

function statusLabel(status: MeestConnectionSummary['status'] | undefined): string {
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

function isMeestConnection(value: unknown): value is MeestConnectionSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'MEEST'
    && (record.status === 'ACTIVE' || record.status === 'NEEDS_ATTENTION' || record.status === 'DISCONNECTED')
    && (typeof record.accountLabel === 'string' || record.accountLabel === null)
    && (typeof record.lastVerifiedAt === 'string' || record.lastVerifiedAt === null)
    && (typeof record.lastErrorCode === 'string' || record.lastErrorCode === null)
    && (record.senderProfile === null || isMeestSenderProfile(record.senderProfile));
}

function isMeestSenderProfile(value: unknown): value is MeestSenderProfileInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.senderName === 'string' && typeof profile.senderPhone === 'string'
    && typeof profile.origin === 'object' && profile.origin !== null
    && typeof profile.defaultParcel === 'object' && profile.defaultParcel !== null
    && (profile.payer === 'SENDER' || profile.payer === 'RECIPIENT')
    && typeof profile.suggestCustomerNotification === 'boolean'
    && typeof profile.customerNotificationTemplate === 'string';
}

function validProfile(profile: MeestSenderProfileInput): boolean {
  return profile.senderName.trim().length >= 2
    && /^\+380\d{9}$/.test(profile.senderPhone)
    && Boolean(profile.origin.cityRef && profile.origin.locationRef && profile.origin.label)
    && Object.values(profile.defaultParcel).every((value) => Number.isFinite(value) && value > 0)
    && Boolean(profile.customerNotificationTemplate.trim());
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
