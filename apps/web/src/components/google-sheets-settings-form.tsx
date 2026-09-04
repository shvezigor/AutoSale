'use client';

import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export interface GoogleSheetsSettings {
  spreadsheetId: string | null;
  sheetName: string;
  status: string;
  requiredHeaders: string[];
  lastValidatedAt: string | null;
  errorSummary: string | null;
}

export function GoogleSheetsSettingsForm({ initial, googleConnected = true, autoOpenPicker = false }: { initial: GoogleSheetsSettings; googleConnected?: boolean; autoOpenPicker?: boolean }) {
  const [settings, setSettings] = useState(initial);
  const [spreadsheetId, setSpreadsheetId] = useState(initial.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(initial.sheetName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.errorSummary);
  const [pending, setPending] = useState(false);
  const [tabs, setTabs] = useState<Array<{ sheetId: number; title: string }>>([]);
  const activity = useActivity();
  const toast = useToast();

  async function selectSpreadsheet(selection: GooglePickerSelection) {
    setPending(true); setMessage(null); setError(null);
    await activity.run('Перевіряємо Google таблицю', async () => { try {
      const response = await fetch(`/api/integrations/google/files/${encodeURIComponent(selection.fileId)}/tabs`, { cache: 'no-store' });
      const body = await response.json() as { spreadsheetId?: string; tabs?: Array<{ sheetId: number; title: string }>; message?: string };
      if (!response.ok || body.spreadsheetId !== selection.fileId || !Array.isArray(body.tabs) || body.tabs.length === 0) {
        throw new Error(body.message ?? 'Не вдалося перевірити Google таблицю');
      }
      setSpreadsheetId(body.spreadsheetId);
      setTabs(body.tabs);
      setSheetName(body.tabs[0]!.title);
      if (body.tabs.length === 1) {
        await saveDestination(body.spreadsheetId, body.tabs[0]!.title, true);
      } else {
        setMessage('Оберіть вкладку, куди записувати замовлення.');
      }
    } catch (reason) { const text = reason instanceof Error ? reason.message : 'Сталася помилка'; setError(text); toast.show({ type: 'error', title: 'Не вдалося обрати таблицю', message: text }); }
    finally { setPending(false); } });
  }

  async function saveDestination(nextSpreadsheetId = spreadsheetId, nextSheetName = sheetName, validateAfterSave = false) {
    setPending(true); setMessage(null); setError(null);
    await activity.run('Зберігаємо таблицю замовлень', async () => { try {
      const response = await mutatingFetch('/api/settings/google-sheets', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spreadsheetId: nextSpreadsheetId, sheetName: nextSheetName }) });
      if (!response.ok) throw new Error('Не вдалося зберегти конфігурацію');
      const savedSettings = await response.json() as GoogleSheetsSettings;
      setSettings(savedSettings);
      if (validateAfterSave) await validateDestination(savedSettings, false);
      else { setMessage('Конфігурацію збережено'); toast.show({ type: 'success', title: 'Підключення збережено' }); }
    } catch (reason) { const text = reason instanceof Error ? reason.message : 'Сталася помилка'; setError(text); toast.show({ type: 'error', title: 'Не вдалося зберегти підключення', message: text }); }
    finally { setPending(false); } });
  }

  async function validateDestination(currentSettings = settings, trackActivity = true) {
    setPending(true); setMessage(null); setError(null);
    const operation = async () => { try {
      const response = await mutatingFetch('/api/settings/google-sheets/validate', { method: 'POST' });
      const body = await response.json() as { valid?: boolean; missingHeaders?: string[]; initialized?: boolean; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося перевірити доступ');
      if (!body.valid) throw new Error(`Відсутні колонки: ${body.missingHeaders?.join(', ')}`);
      const success = body.initialized ? 'Шаблон AutoSale створено. Експорт активний.' : 'Підключення активне';
      setSettings({ ...currentSettings, status: 'ACTIVE' }); setMessage(success); toast.show({ type: 'success', title: body.initialized ? 'Шаблон AutoSale створено' : 'Експорт замовлень активний' });
    } catch (reason) { const text = reason instanceof Error ? reason.message : 'Сталася помилка'; setError(text); toast.show({ type: 'error', title: 'Не вдалося перевірити експорт', message: text }); }
    finally { setPending(false); } };
    if (trackActivity) await activity.run('Перевіряємо експорт замовлень', operation);
    else await operation();
  }

  return <section className="settings-card sheets-card data-task-card" aria-labelledby="sheets-title">
    <div className="settings-card-heading"><div><h2 id="sheets-title">Експорт замовлень</h2><p>Підтверджені замовлення автоматично записуватимуться у вибрану таблицю.</p></div><span className={`connection-status status-${settings.status.toLowerCase()}`}>{statusLabel(settings.status)}</span></div>
    {!googleConnected && <p className="settings-step-notice">Під час вибору Google один раз попросить доступ до обраної таблиці.</p>}
    <GooglePickerButton label="Обрати таблицю для замовлень" connected={googleConnected} intent="orders" autoOpen={autoOpenPicker} disabled={pending} onSelected={(selection) => void selectSpreadsheet(selection)} />
    {spreadsheetId && <div className="data-selection-summary"><span>Таблицю обрано</span><strong>{sheetName || 'Оберіть вкладку'}</strong></div>}
    {tabs.length > 1 && <label className="data-tab-choice"><span>Куди записувати замовлення</span><select aria-label="Назва вкладки" value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label>}
    <div className="settings-actions">{spreadsheetId && tabs.length !== 1 && <LoadingButton pending={pending} pendingLabel="Зберігаємо…" disabled={!sheetName.trim()} onClick={() => void saveDestination()} type="button">Зберегти підключення</LoadingButton>}<LoadingButton className="text-button" pending={pending} pendingLabel="Перевіряємо…" disabled={settings.status === 'NOT_CONFIGURED'} onClick={() => void validateDestination()} type="button">Перевірити</LoadingButton>{message && <span className="save-success">{message}</span>}{error && <span className="save-error" role="alert">{error}</span>}</div>
  </section>;
}

function statusLabel(status: string) { return ({ ACTIVE: 'Активне', PENDING: 'Очікує перевірки', INVALID_HEADERS: 'Немає колонок', ERROR: 'Помилка', NOT_CONFIGURED: 'Не налаштовано' } as Record<string, string>)[status] ?? status; }
