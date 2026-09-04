'use client';

import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';

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

  async function selectSpreadsheet(selection: GooglePickerSelection) {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await fetch(`/api/integrations/google/files/${encodeURIComponent(selection.fileId)}/tabs`, { cache: 'no-store' });
      const body = await response.json() as { spreadsheetId?: string; tabs?: Array<{ sheetId: number; title: string }>; message?: string };
      if (!response.ok || body.spreadsheetId !== selection.fileId || !Array.isArray(body.tabs) || body.tabs.length === 0) {
        throw new Error(body.message ?? 'Не вдалося перевірити Google таблицю');
      }
      setSpreadsheetId(body.spreadsheetId);
      setTabs(body.tabs);
      setSheetName(body.tabs[0]!.title);
      setMessage('Таблицю перевірено. Оберіть вкладку та збережіть.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function save() {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await mutatingFetch('/api/settings/google-sheets', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spreadsheetId, sheetName }) });
      if (!response.ok) throw new Error('Не вдалося зберегти конфігурацію');
      setSettings(await response.json() as GoogleSheetsSettings); setMessage('Конфігурацію збережено');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function validate() {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await mutatingFetch('/api/settings/google-sheets/validate', { method: 'POST' });
      const body = await response.json() as { valid?: boolean; missingHeaders?: string[]; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося перевірити доступ');
      if (!body.valid) throw new Error(`Відсутні колонки: ${body.missingHeaders?.join(', ')}`);
      setSettings({ ...settings, status: 'ACTIVE' }); setMessage('Підключення активне');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  return <section className="settings-card sheets-card data-task-card" aria-labelledby="sheets-title">
    <div className="settings-card-heading"><div><h2 id="sheets-title">Експорт замовлень</h2><p>Підтверджені замовлення автоматично записуватимуться у вибрану таблицю.</p></div><span className={`connection-status status-${settings.status.toLowerCase()}`}>{statusLabel(settings.status)}</span></div>
    {!googleConnected && <p className="settings-step-notice">Під час вибору Google один раз попросить доступ до обраної таблиці.</p>}
    <GooglePickerButton label="Обрати таблицю для замовлень" connected={googleConnected} intent="orders" autoOpen={autoOpenPicker} disabled={pending} onSelected={(selection) => void selectSpreadsheet(selection)} />
    {spreadsheetId && <div className="data-selection-summary"><span>Таблицю обрано</span><strong>{sheetName || 'Оберіть вкладку'}</strong></div>}
    {tabs.length > 1 && <label className="data-tab-choice"><span>Куди записувати замовлення</span><select aria-label="Назва вкладки" value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label>}
    <div className="settings-actions">{spreadsheetId && <button disabled={pending || !sheetName.trim()} onClick={() => void save()} type="button">Зберегти підключення</button>}<button className="text-button" disabled={pending || settings.status === 'NOT_CONFIGURED'} onClick={() => void validate()} type="button">Перевірити</button>{message && <span className="save-success">{message}</span>}{error && <span className="save-error" role="alert">{error}</span>}</div>
  </section>;
}

function statusLabel(status: string) { return ({ ACTIVE: 'Активне', PENDING: 'Очікує перевірки', INVALID_HEADERS: 'Немає колонок', ERROR: 'Помилка', NOT_CONFIGURED: 'Не налаштовано' } as Record<string, string>)[status] ?? status; }
