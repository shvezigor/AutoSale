'use client';

import { ChangeEvent, useCallback, useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';

type Target = 'sku' | 'name' | 'description' | 'price' | 'currency' | 'stockQuantity' | 'category' | 'brand' | 'aliases' | 'color' | 'size' | 'imageUrls' | 'active' | 'attributes' | 'ignore';
type Column = { source: string; target: Target; confidence?: number };
type Session = { membershipRole: 'OWNER' | 'MANAGER' | null };
type UploadResult = { id: string; headers: string[] };
type Status = { status: string; headers?: string[]; mapping: { columns: Column[] } | null; mappingFailure: 'MAPPING_UNAVAILABLE' | null; createdRows?: number; updatedRows?: number; skippedRows?: number; failedRows?: number };
type Preview = { totals: { created: number; updated: number; skipped: number; failed: number } };

const targets: Target[] = ['ignore', 'sku', 'name', 'description', 'price', 'currency', 'stockQuantity', 'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes'];
const stepLabels = ['Джерело', 'Завантаження', 'Аналіз колонок', 'Зіставлення', 'Перевірка', 'Попередній перегляд', 'Підтвердження та прогрес'];

export function CatalogueImportWizard({ session, reviewRuns = [] }: { session: Session; reviewRuns?: Array<{ id: string; sourceName: string; headers: string[] }> }) {
  const [file, setFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [step, setStep] = useState(1);
  const [manualFallback, setManualFallback] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<Status | null>(null);
  const [statusRetry, setStatusRetry] = useState(0);

  const pollStatus = useCallback(async (id: string, fallbackHeaders: string[]) => {
    try {
      const response = await fetch(`/api/catalogue/imports/${id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('status unavailable');
      const status = await response.json() as Status;
      if (status.status === 'MAPPING_REVIEW') {
        const availableHeaders = status.headers?.length ? status.headers : fallbackHeaders;
        const proposed = status.mapping?.columns ?? availableHeaders.map((source) => ({ source, target: 'ignore' as const }));
        setColumns(proposed);
        setManualFallback(Boolean(status.mappingFailure) || !status.mapping);
        setStep(4);
        return;
      }
      window.setTimeout(() => void pollStatus(id, fallbackHeaders), 1_500);
    } catch {
      setManualFallback(true);
      setColumns(fallbackHeaders.map((source) => ({ source, target: 'ignore' })));
      setStep(4);
    }
  }, []);

  useEffect(() => {
    if (!runId || step !== 3) return;
    void pollStatus(runId, headers);
  }, [headers, pollStatus, runId, step]);

  useEffect(() => {
    if (!runId || step !== 7) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/catalogue/imports/${runId}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('status unavailable');
        const status = await response.json() as Status;
        if (!active) return;
        setImportStatus(status);
        setError(null);
        if (status.status !== 'COMPLETED' && status.status !== 'FAILED') timer = window.setTimeout(() => void poll(), 1_500);
      } catch {
        if (!active) return;
        setError('Не вдалося оновити стан імпорту.');
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [runId, statusRetry, step]);

  if (session.membershipRole !== 'OWNER') return null;

  async function upload() {
    if (!file) { setError('Оберіть CSV або XLSX файл каталогу.'); return; }
    setError(null);
    const body = new FormData();
    body.set('file', file);
    const response = await mutatingFetch('/api/catalogue/imports/upload', { method: 'POST', body });
    if (!response.ok) { setError('Не вдалося завантажити каталог.'); return; }
    const result = await response.json() as UploadResult;
    setRunId(result.id);
    setHeaders(result.headers);
    setStep(3);
  }

  function openReview(run: { id: string; headers: string[] }) {
    setRunId(run.id); setHeaders(run.headers); setColumns([]); setError(null); setStep(3);
  }

  function checkMapping() {
    const values = columns.map((column) => column.target);
    if (!values.includes('sku') || !values.includes('name')) { setError('Зіставте обов’язкові поля SKU та назву.'); return; }
    if (new Set(values.filter((target) => target !== 'ignore')).size !== values.filter((target) => target !== 'ignore').length) { setError('Кожне поле товару можна зіставити лише з однією колонкою.'); return; }
    setError(null);
    setStep(5);
  }

  async function createPreview() {
    if (!runId) return;
    const response = await mutatingFetch(`/api/catalogue/imports/${runId}/mapping`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ columns }) });
    if (!response.ok) { setError('Не вдалося створити попередній перегляд.'); return; }
    setPreview(await response.json() as Preview);
    setStep(6);
  }

  async function confirmImport() {
    if (!runId || !confirmed) return;
    const response = await mutatingFetch(`/api/catalogue/imports/${runId}/confirm`, { method: 'POST' });
    if (!response.ok) { setError('Не вдалося підтвердити імпорт.'); return; }
    setImportStatus(await response.json() as Status);
    setError(null);
    setStep(7);
  }

  const updateColumn = (source: string) => (event: ChangeEvent<HTMLSelectElement>) => setColumns((current) => current.map((column) => column.source === source ? { ...column, target: event.target.value as Target } : column));

  return <section className="catalogue-import-wizard" aria-label="Імпорт каталогу">
    <ol className="catalogue-import-steps">{stepLabels.map((label, index) => <li key={label} className={step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''}><span>Крок {index + 1} з 7</span>{label}</li>)}</ol>
    {error ? <p className="catalogue-import-error" role="alert">{error}</p> : null}
    {step === 1 ? <div className="catalogue-import-panel"><h2>Оберіть джерело</h2><p>Завантажте CSV або XLSX або продовжте перевірку Google Sheets. Дані рядків залишаються на сервері.</p>{reviewRuns.map((run) => <button key={run.id} type="button" className="secondary-button" onClick={() => openReview(run)}>Переглянути {run.sourceName}</button>)}<button type="button" className="secondary-button" onClick={() => setStep(2)}>Обрати файл</button></div> : null}
    {step === 2 ? <div className="catalogue-import-panel"><h2>Завантажте каталог</h2><label>Файл каталогу<input aria-label="Файл каталогу" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="primary-button" onClick={() => void upload()}>Завантажити каталог</button></div> : null}
    {step === 3 ? <div className="catalogue-import-panel" aria-live="polite"><h2>Аналіз колонок</h2><p>AI аналізує лише назви колонок, типи та до п’яти обмежених прикладів.</p><p>Готуємо пропозицію зіставлення…</p></div> : null}
    {step === 4 ? <div className="catalogue-import-panel"><h2>{manualFallback ? 'AI недоступний — зіставте колонки вручну' : 'AI запропонував зіставлення'}</h2><p>Перевірте кожну колонку перед імпортом. AI не змінює значення товарів.</p><div className="catalogue-mapping-grid">{columns.map((column) => <label key={column.source}>{column.source}<small>{column.confidence === undefined ? 'ручне зіставлення' : `${Math.round(column.confidence * 100)}%`}</small><select aria-label={column.source} value={column.target} onChange={updateColumn(column.source)}>{targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label>)}</div><button type="button" className="primary-button" onClick={checkMapping}>Перевірити зіставлення</button></div> : null}
    {step === 5 ? <div className="catalogue-import-panel"><h2>Обов’язкові поля зіставлено</h2><p>SKU та назва готові до перевірки без зміни товарів.</p><button type="button" className="primary-button" onClick={() => void createPreview()}>Створити попередній перегляд</button></div> : null}
    {step === 6 && preview ? <div className="catalogue-import-panel"><h2>Попередній перегляд</h2><dl className="catalogue-import-totals"><div><dt>Нових</dt><dd>Нових: {preview.totals.created}</dd></div><div><dt>Оновлень</dt><dd>Оновлень: {preview.totals.updated}</dd></div><div><dt>Пропущено</dt><dd>{preview.totals.skipped}</dd></div><div><dt>Помилок</dt><dd>{preview.totals.failed}</dd></div></dl><label className="catalogue-confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Я підтверджую зіставлення та підсумки попереднього перегляду</label><button type="button" className="primary-button" disabled={!confirmed} onClick={() => void confirmImport()}>Підтвердити імпорт</button></div> : null}
    {step === 7 ? <div className="catalogue-import-panel" aria-live="polite">{importStatus?.status === 'COMPLETED' ? <><h2>Імпорт завершено</h2><p>Створено: {importStatus.createdRows ?? 0}</p><p>Оновлено: {importStatus.updatedRows ?? 0}</p></> : importStatus?.status === 'FAILED' ? <><h2>Імпорт не завершено</h2><p>Помилок: {importStatus.failedRows ?? 0}</p></> : <><h2>Імпорт обробляється</h2><p>Каталог оновиться після завершення без видалення наявних товарів.</p></>}{error ? <button type="button" className="secondary-button" onClick={() => setStatusRetry((value) => value + 1)}>Оновити стан</button> : null}</div> : null}
  </section>;
}
