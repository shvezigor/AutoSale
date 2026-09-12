'use client';

import type { DeliveryLocation, UkrposhtaConnectionSummary, UkrposhtaSenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { DeliveryLocationPicker } from './delivery-location-picker';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type UkrposhtaSettingsSummary = {
  enabled: boolean;
  connection: UkrposhtaConnectionSummary | null;
};

const emptyProfile: UkrposhtaSenderProfileInput = {
  senderName: '', senderPhone: '',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER', defaultParcel: { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 },
  suggestCustomerNotification: true,
  customerNotificationTemplate: '{company}: відправлення створено. ТТН {trackingNumber}',
};

export function UkrposhtaSettingsCard({ initial, role }: { initial: UkrposhtaSettingsSummary; role: 'OWNER' | 'MANAGER' }) {
  const [connection, setConnection] = useState(initial.connection);
  const [environment, setEnvironment] = useState<'SANDBOX' | 'PRODUCTION'>(initial.connection?.environment ?? 'SANDBOX');
  const [ecomBearer, setEcomBearer] = useState('');
  const [counterpartyToken, setCounterpartyToken] = useState('');
  const [trackingBearer, setTrackingBearer] = useState('');
  const [counterpartyUuid, setCounterpartyUuid] = useState('');
  const [profile, setProfile] = useState<UkrposhtaSenderProfileInput>(initial.connection?.senderProfile ?? emptyProfile);
  const [city, setCity] = useState<DeliveryLocation | null>(null);
  const [pending, setPending] = useState<'connect' | 'disconnect' | 'profile' | null>(null);
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
      setProfile(payload.senderProfile ?? emptyProfile);
      toast.show({ type: 'success', title: 'Укрпошту підключено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося підключити Укрпошту', message: 'Перевірте реквізити з договору Укрпошти.' });
    } finally {
      clearSecrets();
      setPending(null);
    }
  }

  async function saveProfile(): Promise<void> {
    setPending('profile');
    try {
      const response = await activity.run('Зберігаємо відправника Укрпошти', () => mutatingFetch('/api/integrations/delivery/ukrposhta/sender-profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isUkrposhtaSenderProfile(payload)) throw new Error('profile failed');
      setProfile(payload);
      setConnection((current) => current ? { ...current, senderProfile: payload } : current);
      toast.show({ type: 'success', title: 'Відправника Укрпошти збережено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося зберегти відправника Укрпошти' });
    } finally {
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
      setProfile(emptyProfile);
      setCity(null);
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
      ? <>
          {connection?.senderProfile && <div aria-label="Збережений відправник Укрпошти">
            <div className="delivery-account-summary"><span>Відправник</span><strong>{connection.senderProfile.senderName}</strong></div>
            <div className="delivery-account-summary"><span>Телефон</span><strong>{connection.senderProfile.senderPhone}</strong></div>
            <div className="delivery-account-summary"><span>Відділення</span><strong>{connection.senderProfile.origin.label}</strong></div>
            <div className="delivery-account-summary"><span>Платник доставки</span><strong>{connection.senderProfile.payer === 'SENDER' ? 'Відправник' : 'Одержувач'}</strong></div>
            <div className="delivery-account-summary"><span>Посилка за замовчуванням</span><strong>{parcelSummary(connection.senderProfile)}</strong></div>
            <div className="delivery-account-summary"><span>Пропонувати сповіщення</span><strong>{connection.senderProfile.suggestCustomerNotification ? 'Так' : 'Ні'}</strong></div>
            <div className="delivery-account-summary"><span>Шаблон повідомлення</span><strong>{connection.senderProfile.customerNotificationTemplate}</strong></div>
          </div>}
          <p className="delivery-readonly-note">Підключенням перевізника та даними відправника керує власник робочого простору.</p>
        </>
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
          {active && <fieldset className="delivery-sender-form" disabled={pending !== null}>
            <legend>Відправник і точне відділення</legend>
            <div className="ukrposhta-connect-grid">
              <label><span>Назва відправника Укрпошти</span><input aria-label="Назва відправника Укрпошти" value={profile.senderName} onChange={(event) => setProfile((current) => ({ ...current, senderName: event.target.value }))} /></label>
              <label><span>Телефон відправника Укрпошти</span><input aria-label="Телефон відправника Укрпошти" inputMode="tel" placeholder="+380501112233" value={profile.senderPhone} onChange={(event) => setProfile((current) => ({ ...current, senderPhone: event.target.value }))} /></label>
            </div>
            <div className="delivery-origin-grid">
              <DeliveryLocationPicker
                provider="UKRPOSHTA"
                label="Місто відправлення Укрпошти"
                type="CITY"
                value={city}
                onSelect={(value) => {
                  setCity(value);
                  setProfile((current) => value?.ref === current.origin.cityRef
                    ? current
                    : {
                        ...current,
                        origin: { type: 'BRANCH', cityRef: value?.ref ?? '', locationRef: '', label: '' },
                      });
                }}
              />
              <DeliveryLocationPicker
                provider="UKRPOSHTA"
                label="Відділення відправлення Укрпошти"
                type="BRANCH"
                {...(city?.ref || profile.origin.cityRef ? { cityRef: city?.ref ?? profile.origin.cityRef } : {})}
                value={profile.origin.locationRef ? { ref: profile.origin.locationRef, provider: 'UKRPOSHTA', type: 'BRANCH', label: profile.origin.label, cityRef: profile.origin.cityRef } : null}
                onSelect={(value) => setProfile((current) => ({
                  ...current,
                  origin: value
                    ? { type: 'BRANCH', cityRef: value.cityRef!, locationRef: value.ref, label: value.label }
                    : { type: 'BRANCH', cityRef: city?.ref ?? '', locationRef: '', label: '' },
                }))}
              />
            </div>
            <div className="delivery-parcel-grid">
              <NumberField label="Вага Укрпошти, кг" value={profile.defaultParcel.weightKg} max={1_000} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, weightKg: value } }))} />
              <NumberField label="Довжина Укрпошти, см" value={profile.defaultParcel.lengthCm} max={300} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, lengthCm: value } }))} />
              <NumberField label="Ширина Укрпошти, см" value={profile.defaultParcel.widthCm} max={300} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, widthCm: value } }))} />
              <NumberField label="Висота Укрпошти, см" value={profile.defaultParcel.heightCm} max={300} onChange={(value) => setProfile((current) => ({ ...current, defaultParcel: { ...current.defaultParcel, heightCm: value } }))} />
            </div>
            <label><span>Хто оплачує доставку Укрпошти</span><select aria-label="Хто оплачує доставку Укрпошти" value={profile.payer} onChange={(event) => setProfile((current) => ({ ...current, payer: event.target.value as UkrposhtaSenderProfileInput['payer'] }))}><option value="SENDER">Відправник</option><option value="RECIPIENT">Одержувач</option></select></label>
            <label className="delivery-checkbox"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile((current) => ({ ...current, suggestCustomerNotification: event.target.checked }))} /><span>Пропонувати повідомлення клієнту після створення ТТН</span></label>
            <label><span>Шаблон повідомлення Укрпошти</span><textarea aria-label="Шаблон повідомлення Укрпошти" value={profile.customerNotificationTemplate} onChange={(event) => setProfile((current) => ({ ...current, customerNotificationTemplate: event.target.value }))} /></label>
            <div className="settings-actions delivery-settings-actions"><LoadingButton type="button" pending={pending === 'profile'} pendingLabel="Зберігаємо…" disabled={pending !== null || !validProfile(profile)} onClick={() => void saveProfile()}>Зберегти відправника Укрпошти</LoadingButton></div>
          </fieldset>}
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
    && (record.environment === 'SANDBOX' || record.environment === 'PRODUCTION' || record.environment === null)
    && (record.senderProfile === null || isUkrposhtaSenderProfile(record.senderProfile));
}

function isUkrposhtaSenderProfile(value: unknown): value is UkrposhtaSenderProfileInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.senderName === 'string' && typeof profile.senderPhone === 'string'
    && typeof profile.origin === 'object' && profile.origin !== null
    && typeof profile.defaultParcel === 'object' && profile.defaultParcel !== null
    && (profile.payer === 'SENDER' || profile.payer === 'RECIPIENT')
    && typeof profile.suggestCustomerNotification === 'boolean'
    && typeof profile.customerNotificationTemplate === 'string';
}

function validProfile(profile: UkrposhtaSenderProfileInput): boolean {
  return profile.senderName.trim().length >= 2 && profile.senderName.trim().length <= 120
    && /^\+380\d{9}$/.test(profile.senderPhone)
    && Boolean(profile.origin.cityRef && profile.origin.locationRef && profile.origin.label)
    && profile.defaultParcel.weightKg > 0 && profile.defaultParcel.weightKg <= 1_000
    && [profile.defaultParcel.lengthCm, profile.defaultParcel.widthCm, profile.defaultParcel.heightCm]
      .every((value) => Number.isFinite(value) && value > 0 && value <= 300)
    && Boolean(profile.customerNotificationTemplate.trim()) && profile.customerNotificationTemplate.trim().length <= 1_000;
}

function parcelSummary(profile: UkrposhtaSenderProfileInput): string {
  const parcel = profile.defaultParcel;
  return `${parcel.weightKg} кг · ${parcel.lengthCm} × ${parcel.widthCm} × ${parcel.heightCm} см`;
}

function NumberField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0.01" max={max} step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
