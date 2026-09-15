'use client';

import { ChangeEvent, useCallback, useEffect, useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';
import { useI18n } from '../i18n/i18n-provider';
import type { Translator } from '../i18n/translator';

type Target = 'sku' | 'name' | 'description' | 'price' | 'currency' | 'stockQuantity' | 'category' | 'brand' | 'aliases' | 'color' | 'size' | 'imageUrls' | 'active' | 'attributes' | 'ignore';
type Column = { source: string; target: Target; confidence?: number };
type Session = { membershipRole: 'OWNER' | 'MANAGER' | null };
type UploadResult = { id: string; headers: string[] };
type Analysis = { version: 2; headerRows: number[]; productRows: number; skippedRows: number; confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW'; reviewReasons: string[] };
type Status = { status: string; headers?: string[]; mapping: { columns: Column[] } | null; mappingFailure: 'MAPPING_UNAVAILABLE' | null; analysis?: Analysis | null; createdRows?: number; updatedRows?: number; skippedRows?: number; failedRows?: number };
type Preview = { totals: { created: number; updated: number; skipped: number; failed: number } };

const targets: Target[] = ['ignore', 'sku', 'name', 'description', 'price', 'currency', 'stockQuantity', 'category', 'brand', 'aliases', 'color', 'size', 'imageUrls', 'active', 'attributes'];

export function CatalogueImportWizard({ session, reviewRuns = [], initialReview }: { session: Session; reviewRuns?: Array<{ id: string; sourceName: string; headers: string[] }>; initialReview?: { id: string; headers: string[] } }) {
  const { t, formatNumber } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [runId, setRunId] = useState<string | null>(initialReview?.id ?? null);
  const [headers, setHeaders] = useState<string[]>(initialReview?.headers ?? []);
  const [columns, setColumns] = useState<Column[]>([]);
  const [step, setStep] = useState(initialReview ? 3 : 1);
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
      setImportStatus(status);
      if (status.status === 'MAPPING_REVIEW') {
        const availableHeaders = status.headers?.length ? status.headers : fallbackHeaders;
        const proposed = status.mapping?.columns ?? availableHeaders.map((source) => ({ source, target: 'ignore' as const }));
        setColumns(proposed);
        setManualFallback(Boolean(status.mappingFailure) || !status.mapping);
        setStep(4);
        return;
      }
      if (status.status === 'COMPLETED' || status.status === 'FAILED') {
        setStep(7);
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
        setError(t('catalogueImport.statusUpdateFailed'));
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [runId, statusRetry, step, t]);

  if (session.membershipRole !== 'OWNER') return null;

  async function upload() {
    if (!file) { setError(t('catalogueImport.fileRequired')); return; }
    setError(null);
    const body = new FormData();
    body.set('file', file);
    const response = await mutatingFetch('/api/catalogue/imports/upload', { method: 'POST', body });
    if (!response.ok) { setError(t('catalogueImport.uploadFailed')); return; }
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
    if (!values.includes('name')) { setError(t('catalogueImport.nameMappingRequired')); return; }
    if (new Set(values.filter((target) => target !== 'ignore')).size !== values.filter((target) => target !== 'ignore').length) { setError(t('catalogueImport.duplicateMapping')); return; }
    setError(null);
    setStep(5);
  }

  async function createPreview() {
    if (!runId) return;
    const response = await mutatingFetch(`/api/catalogue/imports/${runId}/mapping`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ columns }) });
    if (!response.ok) { setError(t('catalogueImport.previewFailed')); return; }
    setPreview(await response.json() as Preview);
    setStep(6);
  }

  async function confirmImport() {
    if (!runId || !confirmed) return;
    const response = await mutatingFetch(`/api/catalogue/imports/${runId}/confirm`, { method: 'POST' });
    if (!response.ok) { setError(t('catalogueImport.confirmFailed')); return; }
    setImportStatus(await response.json() as Status);
    setError(null);
    setStep(7);
  }

  const updateColumn = (source: string) => (event: ChangeEvent<HTMLSelectElement>) => setColumns((current) => current.map((column) => column.source === source ? { ...column, target: event.target.value as Target } : column));
  const stepLabels = [t('catalogueImport.steps.source'), t('catalogueImport.steps.upload'), t('catalogueImport.steps.analysis'), t('catalogueImport.steps.mapping'), t('catalogueImport.steps.validation'), t('catalogueImport.steps.preview'), t('catalogueImport.steps.progress')];
  const targetLabels: Record<Target, string> = {
    ignore: t('catalogueImport.targets.ignore'), sku: t('catalogueImport.targets.sku'), name: t('catalogueImport.targets.name'), description: t('catalogueImport.targets.description'), price: t('catalogueImport.targets.price'), currency: t('catalogueImport.targets.currency'), stockQuantity: t('catalogueImport.targets.stockQuantity'), category: t('catalogueImport.targets.category'), brand: t('catalogueImport.targets.brand'), aliases: t('catalogueImport.targets.aliases'), color: t('catalogueImport.targets.color'), size: t('catalogueImport.targets.size'), imageUrls: t('catalogueImport.targets.imageUrls'), active: t('catalogueImport.targets.active'), attributes: t('catalogueImport.targets.attributes'),
  };

  return <section className="catalogue-import-wizard" aria-label={t('catalogueImport.region')}>
    <ol className="catalogue-import-steps">{stepLabels.map((label, index) => <li key={label} className={step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''}><span>{t('catalogueImport.step', { current: index + 1, total: stepLabels.length })}</span>{label}</li>)}</ol>
    {error ? <p className="catalogue-import-error" role="alert">{error}</p> : null}
    {step === 1 ? <div className="catalogue-import-panel"><h2>{t('catalogueImport.chooseSource')}</h2><p>{t('catalogueImport.chooseSourceDescription')}</p>{reviewRuns.map((run) => <button key={run.id} type="button" className="secondary-button" onClick={() => openReview(run)}>{t('catalogueImport.reviewSource', { name: run.sourceName })}</button>)}<button type="button" className="secondary-button" onClick={() => setStep(2)}>{t('catalogueImport.chooseFile')}</button></div> : null}
    {step === 2 ? <div className="catalogue-import-panel"><h2>{t('catalogueImport.uploadTitle')}</h2><label>{t('catalogueImport.fileLabel')}<input aria-label={t('catalogueImport.fileLabel')} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" className="primary-button" onClick={() => void upload()}>{t('catalogueImport.upload')}</button></div> : null}
    {step === 3 ? <div className="catalogue-import-panel" aria-live="polite" aria-busy="true"><h2>{analysisStage(t, importStatus?.status)}</h2><p>{t('catalogueImport.analysisDescription')}</p></div> : null}
    {step === 4 ? <div className="catalogue-import-panel"><h2>{manualFallback ? t('catalogueImport.manualMapping') : t('catalogueImport.suggestedMapping')}</h2><p>{t('catalogueImport.mappingDescription')}</p>{importStatus?.analysis && importStatus.analysis.confidenceBand !== 'HIGH' ? <div className="catalogue-analysis-review"><p>{t('catalogueImport.headerRows', { rows: formatHeaderRows(t, importStatus.analysis.headerRows) })}</p><a href="#catalogue-mapping">{t('catalogueImport.reviewUncertain')}</a></div> : null}<div id="catalogue-mapping" className="catalogue-mapping-grid">{columns.map((column) => <label key={column.source}>{column.source}<small>{column.confidence === undefined ? t('catalogueImport.manualConfidence') : formatNumber(column.confidence, { style: 'percent', maximumFractionDigits: 0 })}</small><select aria-label={column.source} value={column.target} onChange={updateColumn(column.source)}>{targets.map((target) => <option key={target} value={target}>{targetLabels[target]}</option>)}</select></label>)}</div><button type="button" className="primary-button" onClick={checkMapping}>{t('catalogueImport.checkMapping')}</button></div> : null}
    {step === 5 ? <div className="catalogue-import-panel"><h2>{t('catalogueImport.requiredMapped')}</h2><p>{columns.some((column) => column.target === 'sku') ? t('catalogueImport.skuReady') : t('catalogueImport.skuGenerated')}</p><button type="button" className="primary-button" onClick={() => void createPreview()}>{t('catalogueImport.createPreview')}</button></div> : null}
    {step === 6 && preview ? <div className="catalogue-import-panel"><h2>{t('catalogueImport.previewTitle')}</h2><dl className="catalogue-import-totals"><div><dt>{t('catalogueImport.createdLabel')}</dt><dd>{t('catalogueImport.createdCount', { count: formatNumber(preview.totals.created) })}</dd></div><div><dt>{t('catalogueImport.updatedLabel')}</dt><dd>{t('catalogueImport.updatedCount', { count: formatNumber(preview.totals.updated) })}</dd></div><div><dt>{t('catalogueImport.skippedLabel')}</dt><dd>{formatNumber(preview.totals.skipped)}</dd></div><div><dt>{t('catalogueImport.failedLabel')}</dt><dd>{formatNumber(preview.totals.failed)}</dd></div></dl><label className="catalogue-confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t('catalogueImport.confirmReview')}</label><button type="button" className="primary-button" disabled={!confirmed} onClick={() => void confirmImport()}>{t('catalogueImport.confirm')}</button></div> : null}
    {step === 7 ? <div className="catalogue-import-panel" aria-live="polite">{importStatus?.status === 'COMPLETED' ? <><h2>{t('catalogueImport.completed')}</h2><p>{t('catalogueImport.createdResult', { count: formatNumber(importStatus.createdRows ?? 0) })}</p><p>{t('catalogueImport.updatedResult', { count: formatNumber(importStatus.updatedRows ?? 0) })}</p></> : importStatus?.status === 'FAILED' ? <><h2>{t('catalogueImport.failed')}</h2><p>{t('catalogueImport.failedResult', { count: formatNumber(importStatus.failedRows ?? 0) })}</p></> : <><h2>{t('catalogueImport.processing')}</h2><p>{t('catalogueImport.processingDescription')}</p></>}{error ? <button type="button" className="secondary-button" onClick={() => setStatusRetry((value) => value + 1)}>{t('catalogueImport.retryStatus')}</button> : null}</div> : null}
  </section>;
}

function analysisStage(t: Translator, status?: string): string {
  if (status === 'MAPPING') return t('catalogueImport.analysisMapping');
  if (status === 'PREVIEW_READY') return t('catalogueImport.analysisRows');
  if (status === 'PROCESSING') return t('catalogueImport.analysisImporting');
  return t('catalogueImport.analysisReading');
}

function formatHeaderRows(t: Translator, rows: number[]): string {
  if (rows.length === 0) return t('catalogueImport.notDetected');
  return rows.length === 1 ? String(rows[0]) : `${rows[0]}–${rows.at(-1)}`;
}
