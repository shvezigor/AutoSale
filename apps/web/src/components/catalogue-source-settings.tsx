'use client';

import { useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';

export type CatalogueSourceHealth = {
  id: string; type: string; displayName: string; status: string; lastSyncedAt: string | null; lastErrorSummary: string | null; updatedAt: string;
};
export type CatalogueSourceConfiguration = CatalogueSourceHealth & {
  spreadsheetId: string | null; sheetName: string | null; syncSchedule: 'MANUAL' | 'HOURLY' | 'DAILY';
  serviceAccountEmail: string | null; authorizationAction: string;
  pendingReview?: { runId: string; headers: string[] } | null;
  latestRun?: { id: string; status: string; createdRows: number; updatedRows: number; skippedRows: number; failedRows: number } | null;
};

export function CatalogueSourceSettings({
  role,
  sources,
  configurations,
  googleConnected = true,
  autoOpenPicker = false,
}: {
  role: 'OWNER' | 'MANAGER';
  sources: CatalogueSourceHealth[];
  configurations: CatalogueSourceConfiguration[];
  googleConnected?: boolean;
  autoOpenPicker?: boolean;
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
  const fileInput = useRef<HTMLInputElement>(null);

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
      setDisplayName(selection.name);
      setMessage(body.tabs.length === 1 ? 'Таблицю розпізнано. Натисніть «Завантажити товари».' : 'Оберіть вкладку з товарами.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося перевірити таблицю'); }
    finally { setPending(false); }
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setPending(true); setMessage(null); setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await mutatingFetch('/api/catalogue/imports/upload', { method: 'POST', body: form });
      const body = await response.json() as { status?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? 'Не вдалося завантажити файл');
      setMessage(body.status === 'COMPLETED' ? 'Готово — товари завантажено.' : 'Файл прийнято. AutoSale розпізнає колонки й завантажить товари.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося завантажити файл'); }
    finally { setPending(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function remove() {
    if (!current) return;
    const result = await mutate(`/api/catalogue/sources/${current.id}`, { method: 'DELETE' }, 'Джерело видалено');
    if (result) select(null);
  }

  return <section className="catalogue-source-settings data-task-card" aria-labelledby="catalogue-source-title">
    <div className="catalogue-source-heading"><div><h2 id="catalogue-source-title">Товари</h2><p>Оберіть таблицю або файл — AutoSale сам розпізнає колонки та підготує каталог.</p></div>{current && <span className={`catalogue-status ${current.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(current.status)}</span>}</div>
    {!googleConnected && <p className="settings-step-notice">Під час вибору таблиці Google один раз попросить доступ до неї.</p>}
    <div className="data-source-actions"><GooglePickerButton label="Обрати Google-таблицю" connected={googleConnected} intent="catalogue" autoOpen={autoOpenPicker} disabled={pending} onSelected={(selection) => void selectSpreadsheet(selection)} /><span>або</span><button className="secondary-button" disabled={pending} type="button" onClick={() => fileInput.current?.click()}>Завантажити CSV або Excel</button><input ref={fileInput} className="sr-only" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void uploadFile(event.target.files?.[0])} /></div>
    {spreadsheet && <div className="data-selection-summary"><span>Джерело товарів</span><strong>{displayName}</strong></div>}
    {current?.latestRun && <ImportRunState run={current.latestRun} />}
    {tabs.length > 1 && <label className="data-tab-choice"><span>Вкладка з товарами</span><select aria-label="Вкладка Google таблиці" value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label>}
    <div className="catalogue-source-actions">
      {spreadsheet && <button disabled={pending || !displayName.trim() || !sheetName.trim()} onClick={() => void save()} type="button">Завантажити товари</button>}
      {current && <button className="text-button" disabled={pending} onClick={() => void remove()} type="button">Замінити джерело</button>}
    </div>
    {message && <p className="save-success">{message}</p>}{error && <p className="save-error" role="alert">{error}</p>}
  </section>;
}

function ImportRunState({ run }: { run: NonNullable<CatalogueSourceConfiguration['latestRun']> }) {
  if (run.status === 'COMPLETED') return <div className="data-import-result is-ready"><strong>Готово</strong><span>Додано: {run.createdRows} · оновлено: {run.updatedRows} · пропущено: {run.skippedRows}</span></div>;
  if (run.status === 'MAPPING_REVIEW' || run.status === 'PREVIEW_READY') return <div className="data-import-result is-review"><strong>Потрібна перевірка</strong><span>AutoSale не впевнений у відповідності колонок.</span><a href={`/catalogue?review=${encodeURIComponent(run.id)}`}>Перевірити сумнівні поля</a></div>;
  if (run.status === 'FAILED') return <div className="data-import-result is-error"><strong>Не вдалося завантажити</strong><span>Перевірте файл або спробуйте ще раз.</span></div>;
  return <div className="data-import-result is-working" aria-live="polite"><strong>Розпізнаємо товари</strong><span>Обрано → аналізуємо → завантажуємо</span></div>;
}

function HealthList({ sources }: { sources: CatalogueSourceHealth[] }) {
  return <section className="catalogue-source-settings" aria-labelledby="catalogue-source-health-title"><h2 id="catalogue-source-health-title">Стан джерела каталогу</h2>{sources.length === 0 ? <p>Джерело не налаштовано.</p> : sources.map((source) => <div className="catalogue-source-health" key={source.id}><div><strong>{source.displayName}</strong><small>Остання синхронізація: {source.lastSyncedAt ? formatDate(source.lastSyncedAt) : 'ще не була'}</small></div><span className={`catalogue-status ${source.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(source.status)}</span></div>)}</section>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat('uk-UA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(value)); }
function statusLabel(status: string) { return ({ ACTIVE: 'Активне', PENDING: 'Очікує', PAUSED: 'Призупинено', ERROR: 'Помилка', DISCONNECTED: 'Немає доступу' } as Record<string, string>)[status] ?? status; }
