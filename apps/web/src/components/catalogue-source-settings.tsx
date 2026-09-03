'use client';

import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';

export type CatalogueSourceHealth = {
  id: string; type: string; displayName: string; status: string; lastSyncedAt: string | null; lastErrorSummary: string | null; updatedAt: string;
};
export type CatalogueSourceConfiguration = CatalogueSourceHealth & {
  spreadsheetId: string | null; sheetName: string | null; syncSchedule: 'MANUAL' | 'HOURLY' | 'DAILY';
  serviceAccountEmail: string | null; authorizationAction: string;
  pendingReview?: { runId: string; headers: string[] } | null;
};

export function CatalogueSourceSettings({
  role,
  sources,
  configurations,
  googleConnected = true,
}: {
  role: 'OWNER' | 'MANAGER';
  sources: CatalogueSourceHealth[];
  configurations: CatalogueSourceConfiguration[];
  googleConnected?: boolean;
}) {
  const [current, setCurrent] = useState(configurations[0] ?? null);
  const [displayName, setDisplayName] = useState(current?.displayName ?? 'Каталог Google Sheets');
  const [spreadsheet, setSpreadsheet] = useState(current?.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(current?.sheetName ?? 'Товари');
  const [schedule, setSchedule] = useState<'MANUAL' | 'HOURLY' | 'DAILY'>(current?.syncSchedule ?? 'MANUAL');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ sheetId: number; title: string }>>([]);

  if (role === 'MANAGER') return <HealthList sources={sources} />;

  function select(configuration: CatalogueSourceConfiguration | null) {
    setCurrent(configuration);
    setDisplayName(configuration?.displayName ?? 'Каталог Google Sheets');
    setSpreadsheet(configuration?.spreadsheetId ?? '');
    setSheetName(configuration?.sheetName ?? 'Товари');
    setSchedule(configuration?.syncSchedule ?? 'MANUAL');
    setTabs([]);
    setMessage(null); setError(null);
  }

  async function mutate(path: string, init: RequestInit, success: string) {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await mutatingFetch(path, init);
      const body = await response.json().catch(() => ({})) as CatalogueSourceConfiguration & { message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Операцію не виконано');
      setMessage(success);
      return body;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Операцію не виконано');
      return null;
    } finally {
      setPending(false);
    }
  }

  async function save() {
    const body = JSON.stringify({ displayName, spreadsheet, sheetName, syncSchedule: schedule });
    const result = await mutate(current ? `/api/catalogue/sources/${current.id}` : '/api/catalogue/sources', {
      method: current ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body,
    }, 'Джерело збережено');
    if (result) setCurrent(result);
  }

  async function selectSpreadsheet(selection: GooglePickerSelection) {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await fetch(`/api/integrations/google/files/${encodeURIComponent(selection.fileId)}/tabs`, { cache: 'no-store' });
      const body = await response.json() as { spreadsheetId?: string; tabs?: Array<{ sheetId: number; title: string }>; message?: string };
      if (!response.ok || body.spreadsheetId !== selection.fileId || !body.tabs?.length) throw new Error(body.message ?? 'Не вдалося перевірити таблицю');
      setSpreadsheet(body.spreadsheetId);
      setTabs(body.tabs);
      setSheetName(body.tabs[0]!.title);
      setMessage('Таблицю каталогу перевірено.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося перевірити таблицю'); }
    finally { setPending(false); }
  }

  async function remove() {
    if (!current) return;
    const result = await mutate(`/api/catalogue/sources/${current.id}`, { method: 'DELETE' }, 'Джерело видалено');
    if (result) select(null);
  }

  return <section className="catalogue-source-settings" aria-labelledby="catalogue-source-title">
    <div className="catalogue-source-heading"><div><h2 id="catalogue-source-title">Google Sheets джерело</h2><p>Синхронізуйте товари з окремої таблиці, не змінюючи експорт замовлень.</p></div>{current && <span className={`catalogue-status ${current.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(current.status)}</span>}</div>
    <div className="catalogue-source-actions">
      <label><span>Оберіть джерело</span><select aria-label="Оберіть джерело" value={current?.id ?? ''} onChange={(event) => select(configurations.find((item) => item.id === event.target.value) ?? null)}><option value="">Нове джерело</option>{configurations.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
      <button className="secondary-button" type="button" onClick={() => select(null)}>Додати джерело</button>
    </div>
    {!googleConnected && <p className="settings-step-notice">Спочатку підключіть Google-акаунт.</p>}
    <GooglePickerButton disabled={pending || !googleConnected} onSelected={(selection) => void selectSpreadsheet(selection)} />
    <div className="catalogue-source-grid">
      <label><span>Назва джерела</span><input aria-label="Назва джерела" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label><span>Google таблиця: URL або ID</span><input aria-label="Google таблиця" value={spreadsheet} onChange={(event) => setSpreadsheet(event.target.value)} /></label>
      <label><span>Вкладка</span>{tabs.length > 0 ? <select aria-label="Вкладка Google таблиці" value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select> : <input aria-label="Вкладка Google таблиці" value={sheetName} onChange={(event) => setSheetName(event.target.value)} />}</label>
      <label><span>Розклад синхронізації</span><select aria-label="Розклад синхронізації" value={schedule} onChange={(event) => setSchedule(event.target.value as typeof schedule)}><option value="MANUAL">Лише вручну</option><option value="HOURLY">Щогодини</option><option value="DAILY">Щодня</option></select></label>
    </div>
    <p className="catalogue-source-hint">Оберіть приватну таблицю через Google Picker. AutoSale збереже лише посилання на файл і вкладку, а не ваші ключі.</p>
    <div className="catalogue-source-actions">
      <button disabled={pending || !displayName.trim() || !spreadsheet.trim() || !sheetName.trim()} onClick={() => void save()} type="button">Зберегти джерело</button>
      <button className="secondary-button" disabled={pending || !current} onClick={() => current && void mutate(`/api/catalogue/sources/${current.id}/check`, { method: 'POST' }, 'Доступ підтверджено')} type="button">Перевірити доступ</button>
      <button className="secondary-button" disabled={pending || !current} onClick={() => current && void mutate(`/api/catalogue/sources/${current.id}/sync`, { method: 'POST' }, 'Синхронізацію заплановано')} type="button">Синхронізувати зараз</button>
      {current && <button className="text-button" disabled={pending} onClick={() => void remove()} type="button">Видалити джерело</button>}
    </div>
    {message && <p className="save-success">{message}</p>}{error && <p className="save-error" role="alert">{error}</p>}
  </section>;
}

function HealthList({ sources }: { sources: CatalogueSourceHealth[] }) {
  return <section className="catalogue-source-settings" aria-labelledby="catalogue-source-health-title"><h2 id="catalogue-source-health-title">Стан джерела каталогу</h2>{sources.length === 0 ? <p>Джерело не налаштовано.</p> : sources.map((source) => <div className="catalogue-source-health" key={source.id}><div><strong>{source.displayName}</strong><small>Остання синхронізація: {source.lastSyncedAt ? formatDate(source.lastSyncedAt) : 'ще не була'}</small></div><span className={`catalogue-status ${source.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(source.status)}</span></div>)}</section>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat('uk-UA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value)); }
function statusLabel(status: string) { return ({ ACTIVE: 'Активне', PENDING: 'Очікує', PAUSED: 'Призупинено', ERROR: 'Помилка', DISCONNECTED: 'Немає доступу' } as Record<string, string>)[status] ?? status; }
