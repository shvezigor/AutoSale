'use client';

import type { TelegramSupplierSettings as SupplierSettings } from '../../../../packages/contracts/src/telegram';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export function TelegramSupplierSettings({
  initial,
  navigate = (url) => { window.location.href = url; },
}: {
  initial: SupplierSettings;
  navigate?: (url: string) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const [destinationId, setDestinationId] = useState(initial.selectedDestinationId ?? '');
  const [pendingAction, setPendingAction] = useState<'save' | 'group' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const activity = useActivity();
  const toast = useToast();
  const pending = pendingAction !== null;

  async function save() {
    if (!destinationId) return;
    setPendingAction('save'); setMessage(null);
    try {
      const response = await activity.run('Зберігаємо постачальника', () => mutatingFetch('/api/integrations/telegram/supplier', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destinationId, autoDispatch: false }),
      }));
      if (!response.ok) throw new Error('save failed');
      const next = await response.json() as SupplierSettings;
      setSettings(next); setDestinationId(next.selectedDestinationId ?? ''); setMessage('Постачальника збережено');
      toast.show({ type: 'success', title: 'Постачальника збережено', message: 'Замовлення можна буде надсилати вручну після підтвердження.' });
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося зберегти постачальника' });
    } finally { setPendingAction(null); }
  }

  async function addGroup() {
    setPendingAction('group'); setMessage(null);
    try {
      const response = await activity.run('Відкриваємо Telegram', () => mutatingFetch('/api/integrations/telegram/link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'SUPPLIER_GROUP', returnPath: '/settings?tab=telegram' }),
      }));
      const payload = await response.json() as { url?: string };
      if (!response.ok || !payload.url) throw new Error('group link failed');
      navigate(payload.url);
    } catch {
      toast.show({ type: 'error', title: 'Не вдалося відкрити Telegram' });
    } finally { setPendingAction(null); }
  }

  const selectedChanged = destinationId !== (settings.selectedDestinationId ?? '');
  return <section aria-label="Постачальник у Telegram" className="settings-card telegram-supplier-card">
    <div className="settings-card-heading"><div><h2>Постачальник</h2><p>Надсилайте підтверджені замовлення у вибраний Telegram-чат.</p></div><span className={`connection-status ${settings.selectedDestinationId ? 'status-active' : 'status-not_connected'}`}>{settings.selectedDestinationId ? 'Налаштовано' : 'Не налаштовано'}</span></div>
    <div className="telegram-connection-copy"><strong>Telegram Business</strong><p>У Telegram відкрийте Налаштування → Telegram Business → Чат-боти, додайте @SalesAitoBot і дозвольте чат постачальника. Після нового повідомлення цей чат з’явиться нижче. Історія листування не копіюється.</p></div>
    {settings.destinations.length > 0 && <label className="telegram-supplier-select"><span>Чат постачальника</span><select aria-label="Чат постачальника" disabled={pending} onChange={(event) => { setDestinationId(event.target.value); setMessage(null); }} value={destinationId}><option value="">Оберіть чат</option>{settings.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.title} · {destination.route === 'BUSINESS' ? 'ваш акаунт' : 'група з ботом'}</option>)}</select></label>}
    {settings.destinations.length === 0 && <p className="telegram-supplier-empty">Доступних чатів ще немає. Підключіть Telegram Business або скористайтеся резервною групою.</p>}
    <div className="settings-actions telegram-connection-actions">
      <LoadingButton pending={pendingAction === 'group'} pendingLabel="Відкриваємо…" disabled={pending} className="secondary-button" onClick={() => void addGroup()} type="button">Додати резервну групу</LoadingButton>
      {settings.destinations.length > 0 && <LoadingButton pending={pendingAction === 'save'} pendingLabel="Зберігаємо…" disabled={pending || !destinationId || !selectedChanged} onClick={() => void save()} type="button">Зберегти постачальника</LoadingButton>}
    </div>
    {message && <span className="save-success" role="status">{message}</span>}
  </section>;
}
