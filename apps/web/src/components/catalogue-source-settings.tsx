'use client';

import { useEffect, useRef, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';
import { localizeApiError } from '../i18n/error-message';
import { useActivity } from './activity-provider';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

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
  embedded = false,
  onConfigurationChange,
}: {
  role: 'OWNER' | 'MANAGER';
  sources: CatalogueSourceHealth[];
  configurations: CatalogueSourceConfiguration[];
  googleConnected?: boolean;
  autoOpenPicker?: boolean;
  embedded?: boolean;
  onConfigurationChange?: (configuration: CatalogueSourceConfiguration | null) => void;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const [current, setCurrent] = useState(configurations[0] ?? null);
  const [displayName, setDisplayName] = useState(current?.displayName ?? t('catalogueSource.defaultName'));
  const [spreadsheet, setSpreadsheet] = useState(current?.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(current?.sheetName ?? t('catalogueSource.defaultSheet'));
  const [schedule, setSchedule] = useState<'MANUAL' | 'HOURLY' | 'DAILY'>(current?.syncSchedule ?? 'MANUAL');
  const [pending, setPending] = useState(false);
  const [tracking, setTracking] = useState<{ id: string; previousRun: string | undefined; updatedAt: string; started: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Array<{ sheetId: number; title: string }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const activity = useActivity();
  const toast = useToast();

  useEffect(() => { onConfigurationChange?.(current); }, [current, onConfigurationChange]);

  useEffect(() => {
    if (!tracking) return;
    return activity.begin(t('catalogueSource.processingActivity'));
  }, [activity.begin, t, tracking?.id]);

  useEffect(() => {
    if (!tracking) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/catalogue/sources/${tracking!.id}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(t('catalogueSource.pollFailed'));
        const next = await response.json() as CatalogueSourceConfiguration;
        if (controller.signal.aborted) return;
        const changed = next.updatedAt !== tracking!.updatedAt;
        const terminal = ['COMPLETED', 'FAILED', 'MAPPING_REVIEW', 'PREVIEW_READY'].includes(next.latestRun?.status ?? '');
        const retryPending = next.lastErrorSummary === 'RETRYABLE' || next.lastErrorSummary === 'RATE_LIMIT';
        if (changed && ((!retryPending && next.lastErrorSummary) || (terminal && (next.latestRun?.id !== tracking!.previousRun || next.status === 'ACTIVE')))) {
          setCurrent(next); setTracking(null); setMessage(null);
          toast.show(next.lastErrorSummary || next.latestRun?.status === 'FAILED'
            ? { type: 'error', title: t('catalogueSource.loadFailedTitle'), message: t('catalogueSource.loadFailedHint') }
            : next.latestRun?.status === 'COMPLETED'
              ? { type: 'success', title: t('catalogueSource.loadedTitle'), message: t('catalogueSource.loadedSummary', { created: formatNumber(next.latestRun.createdRows), updated: formatNumber(next.latestRun.updatedRows) }) }
              : { type: 'warning', title: t('catalogueSource.reviewRequired') });
          return;
        }
        if (changed && next.latestRun?.id !== tracking!.previousRun) setCurrent(next);
      } catch {
        if (controller.signal.aborted) return;
      }
      if (Date.now() - tracking!.started > 10 * 60_000) {
        setTracking(null); setMessage(t('catalogueSource.takingLong')); return;
      }
      timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [formatNumber, t, tracking, toast]);

  if (role === 'MANAGER') return <HealthList sources={sources} />;

  function select(configuration: CatalogueSourceConfiguration | null) {
    setCurrent(configuration);
    setDisplayName(configuration?.displayName ?? t('catalogueSource.defaultName'));
    setSpreadsheet(configuration?.spreadsheetId ?? '');
    setSheetName(configuration?.sheetName ?? t('catalogueSource.defaultSheet'));
    setSchedule(configuration?.syncSchedule ?? 'MANUAL');
    setTabs([]);
    setMessage(null); setError(null);
  }

  async function mutate(path: string, init: RequestInit, success: string) {
    setPending(true); setMessage(null); setError(null);
    try {
      const response = await activity.run(success, () => mutatingFetch(path, init));
      const body = await response.json().catch(() => ({})) as CatalogueSourceConfiguration & { message?: string; code?: string };
      if (!response.ok) throw body;
      setMessage(success);
      toast.show({ type: 'success', title: success });
      return body;
    } catch (reason) {
      const text = localizeApiError(reason, t); setError(text); toast.show({ type: 'error', title: t('catalogueSource.operationFailed'), message: text });
      return null;
    } finally {
      setPending(false);
    }
  }

  async function save() {
    const body = JSON.stringify({ displayName, spreadsheet, sheetName, syncSchedule: schedule });
    const result = await mutate(current ? `/api/catalogue/sources/${current.id}` : '/api/catalogue/sources', {
      method: current ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body,
    }, t('catalogueSource.sourceSaved'));
    if (result) {
      setCurrent(result);
      const queued = await mutate(`/api/catalogue/sources/${result.id}/sync`, { method: 'POST' }, t('catalogueSource.sourceConnected'));
      if (queued) setTracking({ id: result.id, previousRun: result.latestRun?.id, updatedAt: result.updatedAt, started: Date.now() });
    }
  }

  async function selectSpreadsheet(selection: GooglePickerSelection) {
    setPending(true); setMessage(null); setError(null); setTabs([]);
    try {
      const response = await activity.run(t('catalogueSource.checkingSheet'), () => fetch(`/api/integrations/google/files/${encodeURIComponent(selection.fileId)}/tabs`, { cache: 'no-store' }));
      const body = await response.json() as { spreadsheetId?: string; tabs?: Array<{ sheetId: number; title: string }>; message?: string; code?: string };
      if (!response.ok || body.spreadsheetId !== selection.fileId || !body.tabs?.length) throw body;
      setSpreadsheet(body.spreadsheetId);
      setTabs(body.tabs);
      setSheetName(body.tabs[0]!.title);
      setDisplayName(selection.name);
      setMessage(body.tabs.length === 1 ? t('catalogueSource.sheetRecognized') : t('catalogueSource.chooseProductTab'));
    } catch (reason) { const text = localizeApiError(reason, t); setError(text); toast.show({ type: 'error', title: t('catalogueSource.sheetCheckFailed'), message: text }); }
    finally { setPending(false); }
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setPending(true); setMessage(null); setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await activity.run(t('catalogueSource.uploadingCatalogue'), () => mutatingFetch('/api/catalogue/imports/upload', { method: 'POST', body: form }));
      const body = await response.json() as { status?: string; message?: string; code?: string };
      if (!response.ok) throw body;
      const success = body.status === 'COMPLETED' ? t('catalogueSource.uploadComplete') : t('catalogueSource.fileAccepted'); setMessage(success); toast.show({ type: 'success', title: t('catalogueSource.catalogueQueued'), message: success });
    } catch (reason) { const text = localizeApiError(reason, t); setError(text); toast.show({ type: 'error', title: t('catalogueSource.fileUploadFailed'), message: text }); }
    finally { setPending(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function remove() {
    if (!current) return;
    const result = await mutate(`/api/catalogue/sources/${current.id}`, { method: 'DELETE' }, t('catalogueSource.sourceRemoved'));
    if (result) select(null);
  }

  return <section className={`catalogue-source-settings data-task-card ${embedded ? 'is-embedded' : ''}`} {...(embedded ? { 'aria-label': t('catalogueSource.title') } : { 'aria-labelledby': 'catalogue-source-title' })}>
    {!embedded && <div className="catalogue-source-heading"><div><h2 id="catalogue-source-title">{t('catalogueSource.title')}</h2><p>{t('catalogueSource.description')}</p></div>{current && <span className={`catalogue-status ${current.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(t, current.status)}</span>}</div>}
    {!googleConnected && <p className="settings-step-notice">{t('catalogueSource.googleAccess')}</p>}
    <div className="data-source-actions"><GooglePickerButton label={t('catalogueSource.chooseGoogle')} connected={googleConnected} intent="catalogue" autoOpen={autoOpenPicker} disabled={pending} onSelected={(selection) => void selectSpreadsheet(selection)} /><span>{t('catalogueSource.or')}</span><button className="secondary-button settings-control settings-control-secondary" disabled={pending} type="button" onClick={() => fileInput.current?.click()}>{t('catalogueSource.uploadFile')}</button><input ref={fileInput} aria-hidden="true" tabIndex={-1} className="sr-only" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void uploadFile(event.target.files?.[0])} /></div>
    {spreadsheet && <div className="data-selection-summary"><span>{t('catalogueSource.productSource')}</span><strong>{displayName}</strong></div>}
    {tabs.length > 1 && <label className="data-tab-choice"><span>{t('catalogueSource.productTab')}</span><select aria-label={t('catalogueSource.googleTab')} value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label>}
    {spreadsheet && <div className="data-import-status-slot">{tracking ? <div className="data-import-result is-working" role="status" aria-busy="true"><strong>{sourceAnalysisStage(t, current?.latestRun?.status)}</strong><span>{t('catalogueSource.resultAutomatic')}</span></div> : current?.spreadsheetId === spreadsheet && current?.sheetName === sheetName && current.lastErrorSummary ? <SourceErrorState code={current.lastErrorSummary} /> : current?.spreadsheetId === spreadsheet && current?.sheetName === sheetName && current.latestRun ? <ImportRunState run={current.latestRun} /> : null}</div>}
    <div className="catalogue-source-actions">
      {spreadsheet && <LoadingButton className="settings-control settings-control-primary" pending={pending} pendingLabel={t('catalogueSource.loading')} disabled={!displayName.trim() || !sheetName.trim()} onClick={() => void save()} type="button">{t('catalogueSource.uploadProducts')}</LoadingButton>}
      {current && <LoadingButton className="text-button settings-control settings-control-secondary" pending={pending} pendingLabel={t('catalogueSource.replacing')} onClick={() => void remove()} type="button">{t('catalogueSource.replaceSource')}</LoadingButton>}
    </div>
    {message && <p className="save-success">{message}</p>}{error && <p className="save-error" role="alert">{error}</p>}
  </section>;
}

function SourceErrorState({ code }: { code: string }) {
  const { t } = useI18n();
  if (code === 'TABLE_HEADER_INVALID') return <div className="data-import-result is-error" role="alert"><strong>{t('catalogueSource.emptySheetTitle')}</strong><span>{t('catalogueSource.emptySheetHint')}</span></div>;
  if (code === 'TABLE_CELL_LIMIT') return <div className="data-import-result is-error" role="alert"><strong>{t('catalogueSource.cellLimitTitle')}</strong><span>{t('catalogueSource.cellLimitHint')}</span></div>;
  if (code === 'TABLE_COLUMN_LIMIT') return <div className="data-import-result is-error" role="alert"><strong>{t('catalogueSource.columnLimitTitle')}</strong><span>{t('catalogueSource.columnLimitHint')}</span></div>;
  return <div className="data-import-result is-error" role="alert"><strong>{t('catalogueSource.genericSourceError')}</strong><span>{t('catalogueSource.genericSourceErrorHint')}</span></div>;
}

function ImportRunState({ run }: { run: NonNullable<CatalogueSourceConfiguration['latestRun']> }) {
  const { t, formatNumber } = useI18n();
  if (run.status === 'COMPLETED') return <div className="data-import-result is-ready"><strong>{t('catalogueSource.ready')}</strong><span>{t('catalogueSource.runSummary', { created: formatNumber(run.createdRows), updated: formatNumber(run.updatedRows), skipped: formatNumber(run.skippedRows) })}</span></div>;
  if (run.status === 'MAPPING_REVIEW' || run.status === 'PREVIEW_READY') return <div className="data-import-result is-review"><strong>{t('catalogueSource.review')}</strong><span>{t('catalogueSource.uncertainColumns')}</span><a href={`/catalogue?review=${encodeURIComponent(run.id)}`}>{t('catalogueSource.reviewFields')}</a></div>;
  if (run.status === 'FAILED') return <div className="data-import-result is-error"><strong>{t('catalogueSource.runFailed')}</strong><span>{t('catalogueSource.runFailedHint')}</span></div>;
  return <div className="data-import-result is-working" aria-live="polite"><strong>{t('catalogueSource.recognizing')}</strong><span>{t('catalogueSource.recognizingSteps')}</span></div>;
}

function HealthList({ sources }: { sources: CatalogueSourceHealth[] }) {
  const { t, formatDate } = useI18n();
  return <section className="catalogue-source-settings" aria-labelledby="catalogue-source-health-title"><h2 id="catalogue-source-health-title">{t('catalogueSource.healthTitle')}</h2>{sources.length === 0 ? <p>{t('catalogueSource.notConfigured')}</p> : sources.map((source) => <div className="catalogue-source-health" key={source.id}><div><strong>{source.displayName}</strong><small>{t('catalogueSource.lastSync', { date: source.lastSyncedAt ? formatDate(source.lastSyncedAt, { year: 'numeric', month: '2-digit', day: '2-digit' }) : t('catalogueSource.neverSynced') })}</small></div><span className={`catalogue-status ${source.status === 'ACTIVE' ? 'is-active' : ''}`}>{statusLabel(t, source.status)}</span></div>)}</section>;
}

function statusLabel(t: Translator, status: string) { return ({ ACTIVE: t('catalogueSource.statusActive'), PENDING: t('catalogueSource.statusPending'), PAUSED: t('catalogueSource.statusPaused'), ERROR: t('catalogueSource.statusError'), DISCONNECTED: t('catalogueSource.statusDisconnected') } as Record<string, string>)[status] ?? status; }
function sourceAnalysisStage(t: Translator, status?: string) {
  if (status === 'MAPPING') return t('catalogueSource.analysisMapping');
  if (status === 'PREVIEW_READY') return t('catalogueSource.analysisRows');
  if (status === 'PROCESSING') return t('catalogueSource.analysisImporting');
  return t('catalogueSource.analysisReading');
}
