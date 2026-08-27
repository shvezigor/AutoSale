'use client';

import { useState } from 'react';

export interface GoogleSheetsSettings {
  spreadsheetId: string | null;
  sheetName: string;
  status: string;
  requiredHeaders: string[];
  lastValidatedAt: string | null;
  errorSummary: string | null;
}

export function GoogleSheetsSettingsForm({ initial }: { initial: GoogleSheetsSettings }) {
  const [settings, setSettings] = useState(initial);
  const [spreadsheetId, setSpreadsheetId] = useState(initial.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(initial.sheetName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.errorSummary);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await fetch('/api/settings/google-sheets', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spreadsheetId, sheetName }) });
      if (!response.ok) throw new Error('Не вдалося зберегти конфігурацію');
      setSettings(await response.json() as GoogleSheetsSettings); setMessage('Конфігурацію збережено');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  async function validate() {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await fetch('/api/settings/google-sheets/validate', { method: 'POST' });
      const body = await response.json() as { valid?: boolean; missingHeaders?: string[]; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося перевірити доступ');
      if (!body.valid) throw new Error(`Відсутні колонки: ${body.missingHeaders?.join(', ')}`);
      setSettings({ ...settings, status: 'ACTIVE' }); setMessage('Підключення активне');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Сталася помилка'); }
    finally { setPending(false); }
  }

  return <section className="settings-card sheets-card" aria-labelledby="sheets-title">
    <div className="settings-card-heading"><div><h2 id="sheets-title">Google Sheets</h2><p>Таблиця для підтверджених замовлень.</p></div><span className={`connection-status status-${settings.status.toLowerCase()}`}>{statusLabel(settings.status)}</span></div>
    <div className="sheets-fields"><label><span>ID Google таблиці</span><input aria-label="ID Google таблиці" value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} placeholder="1AbC…" /></label><label><span>Назва вкладки</span><input aria-label="Назва вкладки" value={sheetName} onChange={(event) => setSheetName(event.target.value)} /></label></div>
    <p className="sheets-hint">Service-account ключ монтується в Docker як секрет і не вводиться у браузері.</p>
    <div className="settings-actions"><button disabled={pending || !spreadsheetId.trim() || !sheetName.trim()} onClick={() => void save()} type="button">Зберегти Google Sheets</button><button className="secondary-button" disabled={pending || settings.status === 'NOT_CONFIGURED'} onClick={() => void validate()} type="button">Перевірити доступ</button>{message && <span className="save-success">{message}</span>}{error && <span className="save-error" role="alert">{error}</span>}</div>
  </section>;
}

function statusLabel(status: string) { return ({ ACTIVE: 'Активне', PENDING: 'Очікує перевірки', INVALID_HEADERS: 'Немає колонок', ERROR: 'Помилка', NOT_CONFIGURED: 'Не налаштовано' } as Record<string, string>)[status] ?? status; }
