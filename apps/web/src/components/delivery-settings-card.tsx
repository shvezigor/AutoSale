'use client';

import type { DeliveryConnectionSummary, DeliverySenderProfileInput } from '../../../../packages/contracts/src/delivery';
import { useCallback, useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { useConfirm } from './confirm-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export type DeliverySettingsSummary = {
  enabled: boolean;
  connections: DeliveryConnectionSummary[];
};

type PendingAction = 'connect' | 'save' | 'disconnect' | null;
type SenderOption = {
  ref: string;
  label: string;
  edrpou: string | null;
  contacts: Array<{ ref: string; label: string; phone: string }>;
  origins: Array<{ ref: string; cityRef: string; label: string; number: string; type: 'BRANCH' | 'PARCEL_LOCKER' }>;
};

const emptyProfile: DeliverySenderProfileInput = {
  senderRef: '',
  contactRef: '',
  contactPhone: '+380',
  origin: { type: 'BRANCH', cityRef: '', locationRef: '', label: '' },
  payer: 'SENDER',
  defaultParcel: { weightKg: 1, lengthCm: 20, widthCm: 20, heightCm: 20 },
  suggestCustomerNotification: true,
  customerNotificationTemplate: '{company}: створено ТТН {trackingNumber}. Відстеження: {trackingUrl}',
};

export function DeliverySettingsCard({
  initial,
  role,
}: {
  initial: DeliverySettingsSummary;
  role: 'OWNER' | 'MANAGER';
}) {
  const [connection, setConnection] = useState<DeliveryConnectionSummary | null>(initial.connections[0] ?? null);
  const [profile, setProfile] = useState<DeliverySenderProfileInput>(initial.connections[0]?.senderProfile ?? emptyProfile);
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState<PendingAction>(null);
  const [senderOptions, setSenderOptions] = useState<SenderOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const activity = useActivity();
  const confirm = useConfirm();
  const toast = useToast();
  const owner = role === 'OWNER';
  const active = connection?.status === 'ACTIVE';
  const selectedSender = senderOptions.find((option) => option.ref === profile.senderRef) ?? null;

  const loadSenderOptions = useCallback(async () => {
    if (!owner) return;
    setLoadingOptions(true);
    try {
      const response = await fetch('/api/integrations/delivery/nova-poshta/sender-options', { credentials: 'same-origin' });
      const payload = await jsonOrNull(response);
      if (response.ok && isSenderOptions(payload)) setSenderOptions(payload);
    } catch {
      // The saved profile remains usable when the provider directory is temporarily unavailable.
    } finally {
      setLoadingOptions(false);
    }
  }, [owner]);

  useEffect(() => {
    if (active) void loadSenderOptions();
  }, [active, loadSenderOptions]);

  async function connect() {
    if (apiKey.trim().length < 8) {
      toast.show({ type: 'error', title: 'Перевірте API-ключ Нової Пошти' });
      return;
    }
    setPending('connect');
    try {
      const response = await activity.run('Підключаємо Нову Пошту', () => mutatingFetch('/api/integrations/delivery/nova-poshta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      }));
      const payload = await jsonOrNull(response);
      if (!response.ok || !isConnectionSummary(payload)) throw new Error('connection failed');
      setConnection(payload);
      setProfile(payload.senderProfile ?? emptyProfile);
      setApiKey('');
      toast.show({ type: 'success', title: 'Нову Пошту підключено' });
      void loadSenderOptions();
    } catch {
      setApiKey('');
      toast.show({
        type: 'error',
        title: 'Не вдалося підключити Нову Пошту',
        message: 'Перевірте ключ у бізнес-кабінеті Нової Пошти та спробуйте ще раз.',
      });
    } finally {
      setPending(null);
    }
  }

  async function saveProfile() {
    setPending('save');
    try {
      const response = await activity.run('Зберігаємо дані відправника', () => mutatingFetch(
        '/api/integrations/delivery/nova-poshta/sender-profile',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(profile),
        },
      ));
      if (!response.ok) throw new Error('save failed');
      setConnection((current) => current ? { ...current, senderProfile: profile } : current);
      toast.show({ type: 'success', title: 'Дані відправника збережено' });
    } catch {
      toast.show({
        type: 'error',
        title: 'Не вдалося зберегти дані відправника',
        message: 'Перевірте обов’язкові поля та повторіть спробу.',
      });
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    const approved = await confirm({
      title: 'Відключити Нову Пошту?',
      description: 'Нові ТТН не створюватимуться. Уже створені відправлення та їхня історія залишаться в AutoSale.',
      confirmLabel: 'Так, відключити',
      tone: 'danger',
    });
    if (!approved) return;
    setPending('disconnect');
    try {
      const response = await activity.run('Відключаємо Нову Пошту', () => mutatingFetch('/api/integrations/delivery/nova-poshta', { method: 'DELETE' }));
      if (!response.ok) throw new Error('disconnect failed');
      setConnection(null);
      setProfile(emptyProfile);
      toast.show({ type: 'success', title: 'Нову Пошту відключено' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося відключити Нову Пошту' });
    } finally {
      setPending(null);
    }
  }

  if (!initial.enabled) return <section className="settings-card delivery-settings-card">
    <div className="settings-card-heading"><div><h2>Нова Пошта</h2><p>Інтеграція доставки ще не активована для AutoSale.</p></div><span className="connection-status status-not_connected">Недоступно</span></div>
  </section>;

  return <section className="settings-card delivery-settings-card" aria-labelledby="delivery-settings-title" aria-busy={pending !== null || undefined}>
    <div className="settings-card-heading">
      <div>
        <h2 id="delivery-settings-title">Нова Пошта</h2>
        <p>Створюйте ТТН та відстежуйте доставку без повторного введення даних.</p>
      </div>
      <span className={`connection-status status-${(connection?.status ?? 'NOT_CONNECTED').toLowerCase()}`}>
        {statusLabel(connection?.status)}
      </span>
    </div>

    {connection?.accountLabel && <div className="delivery-account-summary"><span>Кабінет відправника</span><strong>{connection.accountLabel}</strong></div>}

    {!owner ? <p className="delivery-readonly-note">Змінити підключення та дані відправника може лише власник робочого простору.</p> : <>
      <div className="delivery-connect-form">
        <label>
          <span>API-ключ Нової Пошти</span>
          <input aria-label="API-ключ Нової Пошти" autoComplete="off" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={active ? 'Введіть новий ключ для заміни' : 'Вставте ключ із бізнес-кабінету'} />
        </label>
        <LoadingButton type="button" pending={pending === 'connect'} pendingLabel="Підключаємо…" disabled={pending !== null || apiKey.trim().length < 8} onClick={() => void connect()}>
          {active ? 'Замінити ключ' : 'Підключити Нову Пошту'}
        </LoadingButton>
      </div>

      {active && <>
        <fieldset className="delivery-sender-form" disabled={pending !== null}>
          <legend>Дані відправника</legend>
          <div className="delivery-form-grid">
            <SelectField label="Відправник" value={profile.senderRef} loading={loadingOptions} options={senderOptions.map((sender) => ({ value: sender.ref, label: sender.label }))} onChange={(value) => {
              const sender = senderOptions.find((option) => option.ref === value);
              const contact = sender?.contacts[0];
              const origin = sender?.origins[0];
              setProfile({
                ...profile,
                senderRef: value,
                contactRef: contact?.ref ?? '',
                contactPhone: contact?.phone ?? '+380',
                origin: origin ? { type: origin.type, cityRef: origin.cityRef, locationRef: origin.ref, label: origin.label } : emptyProfile.origin,
              });
            }} />
            <SelectField label="Контактна особа" value={profile.contactRef} loading={loadingOptions} options={(selectedSender?.contacts ?? []).map((contact) => ({ value: contact.ref, label: contact.label }))} onChange={(value) => {
              const contact = selectedSender?.contacts.find((option) => option.ref === value);
              setProfile({ ...profile, contactRef: value, contactPhone: contact?.phone ?? profile.contactPhone });
            }} />
            <TextField label="Телефон відправника" value={profile.contactPhone} onChange={(value) => setProfile({ ...profile, contactPhone: value })} />
            <SelectField label="Точка відправлення" value={profile.origin.type === 'ADDRESS' ? '' : profile.origin.locationRef} loading={loadingOptions} options={(selectedSender?.origins ?? []).map((origin) => ({ value: origin.ref, label: origin.label }))} onChange={(value) => {
              const origin = selectedSender?.origins.find((option) => option.ref === value);
              if (origin) setProfile({ ...profile, origin: { type: origin.type, cityRef: origin.cityRef, locationRef: origin.ref, label: origin.label } });
            }} />
            <label><span>Хто оплачує доставку</span><select aria-label="Хто оплачує доставку" value={profile.payer} onChange={(event) => setProfile({ ...profile, payer: event.target.value as 'SENDER' | 'RECIPIENT' })}><option value="SENDER">Відправник</option><option value="RECIPIENT">Отримувач</option></select></label>
          </div>
          <div className="delivery-parcel-grid">
            <NumberField label="Вага, кг" value={profile.defaultParcel.weightKg} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, weightKg: value } })} />
            <NumberField label="Довжина, см" value={profile.defaultParcel.lengthCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, lengthCm: value } })} />
            <NumberField label="Ширина, см" value={profile.defaultParcel.widthCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, widthCm: value } })} />
            <NumberField label="Висота, см" value={profile.defaultParcel.heightCm} onChange={(value) => setProfile({ ...profile, defaultParcel: { ...profile.defaultParcel, heightCm: value } })} />
          </div>
          <label className="delivery-notification-toggle"><input type="checkbox" checked={profile.suggestCustomerNotification} onChange={(event) => setProfile({ ...profile, suggestCustomerNotification: event.target.checked })} />Запропонувати повідомлення клієнту після створення ТТН</label>
        </fieldset>
        <div className="settings-actions delivery-settings-actions">
          <LoadingButton type="button" pending={pending === 'save'} pendingLabel="Зберігаємо…" disabled={pending !== null} onClick={() => void saveProfile()}>Зберегти дані відправника</LoadingButton>
          <LoadingButton type="button" className="danger-button" pending={pending === 'disconnect'} pendingLabel="Відключаємо…" disabled={pending !== null} onClick={() => void disconnect()}>Відключити Нову Пошту</LoadingButton>
        </div>
      </>}
    </>}
  </section>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label><span>{label}</span><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, options, loading, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; loading: boolean; onChange(value: string): void }) {
  const includesCurrent = options.some((option) => option.value === value);
  return <label><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={loading}>
    <option value="">{loading ? 'Завантажуємо…' : 'Оберіть зі списку'}</option>
    {!includesCurrent && value && <option value={value}>{value}</option>}
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label><span>{label}</span><input aria-label={label} type="number" min="0.01" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function statusLabel(status: DeliveryConnectionSummary['status'] | undefined): string {
  if (!status) return 'Не підключено';
  return ({ ACTIVE: 'Активне', NEEDS_ATTENTION: 'Потрібна увага', DISCONNECTED: 'Відключено' } as const)[status];
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { return null; }
}

function isConnectionSummary(value: unknown): value is DeliveryConnectionSummary {
  if (!isRecord(value)) return false;
  return value.provider === 'NOVA_POSHTA'
    && (value.status === 'ACTIVE' || value.status === 'NEEDS_ATTENTION' || value.status === 'DISCONNECTED')
    && (typeof value.accountLabel === 'string' || value.accountLabel === null)
    && (typeof value.lastVerifiedAt === 'string' || value.lastVerifiedAt === null)
    && (typeof value.lastErrorCode === 'string' || value.lastErrorCode === null)
    && (isRecord(value.senderProfile) || value.senderProfile === null);
}

function isSenderOptions(value: unknown): value is SenderOption[] {
  return Array.isArray(value) && value.every((sender) => isRecord(sender)
    && typeof sender.ref === 'string'
    && typeof sender.label === 'string'
    && Array.isArray(sender.contacts)
    && sender.contacts.every((contact) => isRecord(contact) && typeof contact.ref === 'string' && typeof contact.label === 'string' && typeof contact.phone === 'string')
    && Array.isArray(sender.origins)
    && sender.origins.every((origin) => isRecord(origin) && typeof origin.ref === 'string' && typeof origin.cityRef === 'string' && typeof origin.label === 'string'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
