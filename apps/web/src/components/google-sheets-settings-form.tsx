'use client';

import { useEffect, useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export interface GoogleSheetsSettings {
  spreadsheetId: string | null;
  sheetName: string;
  status: string;
  requiredHeaders: string[];
  lastValidatedAt: string | null;
  errorSummary: string | null;
}

export function GoogleSheetsSettingsForm({ initial, googleConnected = true, autoOpenPicker = false, embedded = false, onSettingsChange }: { initial: GoogleSheetsSettings; googleConnected?: boolean; autoOpenPicker?: boolean; embedded?: boolean; onSettingsChange?: (settings: GoogleSheetsSettings) => void }) {
  const [settings, setSettings] = useState(initial);
  const [spreadsheetId, setSpreadsheetId] = useState(initial.spreadsheetId ?? '');
  const [sheetName, setSheetName] = useState(initial.sheetName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.errorSummary);
  const [pending, setPending] = useState(false);
  const [tabs, setTabs] = useState<Array<{ sheetId: number; title: string }>>([]);
  const activity = useActivity();
  const toast = useToast();
  const { t } = useI18n();

  useEffect(() => { onSettingsChange?.(settings); }, [settings, onSettingsChange]);

  async function selectSpreadsheet(selection: GooglePickerSelection) {
    setPending(true); setMessage(null); setError(null);
    await activity.run(t('googleSettings.checkingSheet'), async () => { try {
      const response = await fetch(`/api/integrations/google/files/${encodeURIComponent(selection.fileId)}/tabs`, { cache: 'no-store' });
      const body = await response.json() as { spreadsheetId?: string; tabs?: Array<{ sheetId: number; title: string }>; message?: string };
      if (!response.ok || body.spreadsheetId !== selection.fileId || !Array.isArray(body.tabs) || body.tabs.length === 0) {
        throw new Error(body.message ?? t('googleSettings.checkSheetFailed'));
      }
      setSpreadsheetId(body.spreadsheetId);
      setTabs(body.tabs);
      setSheetName(body.tabs[0]!.title);
      if (body.tabs.length === 1) {
        await saveDestination(body.spreadsheetId, body.tabs[0]!.title, true);
      } else {
        setMessage(t('googleSettings.selectDestinationHint'));
      }
    } catch (reason) { const text = reason instanceof Error ? reason.message : t('googleSettings.genericError'); setError(text); toast.show({ type: 'error', title: t('googleSettings.sheetSelectionFailed'), message: text }); }
    finally { setPending(false); } });
  }

  async function saveDestination(nextSpreadsheetId = spreadsheetId, nextSheetName = sheetName, validateAfterSave = false) {
    setPending(true); setMessage(null); setError(null);
    await activity.run(t('googleSettings.savingOrdersSheet'), async () => { try {
      const response = await mutatingFetch('/api/settings/google-sheets', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spreadsheetId: nextSpreadsheetId, sheetName: nextSheetName }) });
      if (!response.ok) throw new Error(t('googleSettings.saveConfigurationFailed'));
      const savedSettings = await response.json() as GoogleSheetsSettings;
      setSettings(savedSettings);
      if (validateAfterSave) await validateDestination(savedSettings, false);
      else { setMessage(t('googleSettings.configurationSaved')); toast.show({ type: 'success', title: t('googleSettings.connectionSaved') }); }
    } catch (reason) { const text = reason instanceof Error ? reason.message : t('googleSettings.genericError'); setError(text); toast.show({ type: 'error', title: t('googleSettings.connectionSaveFailed'), message: text }); }
    finally { setPending(false); } });
  }

  async function validateDestination(currentSettings = settings, trackActivity = true) {
    setPending(true); setMessage(null); setError(null);
    const operation = async () => { try {
      const response = await mutatingFetch('/api/settings/google-sheets/validate', { method: 'POST' });
      const body = await response.json() as { valid?: boolean; missingHeaders?: string[]; initialized?: boolean; message?: string };
      if (!response.ok) throw new Error(body.message ?? t('googleSettings.accessCheckFailed'));
      if (!body.valid) throw new Error(t('googleSettings.missingHeaders', { headers: body.missingHeaders?.join(', ') ?? '' }));
      const success = body.initialized ? t('googleSettings.templateCreatedExportActive') : t('googleSettings.connectionActive');
      setSettings({ ...currentSettings, status: 'ACTIVE' }); setMessage(success); toast.show({ type: 'success', title: body.initialized ? t('googleSettings.templateCreated') : t('googleSettings.exportActive') });
    } catch (reason) { const text = reason instanceof Error ? reason.message : t('googleSettings.genericError'); setError(text); toast.show({ type: 'error', title: t('googleSettings.exportCheckFailed'), message: text }); }
    finally { setPending(false); } };
    if (trackActivity) await activity.run(t('googleSettings.checkingExport'), operation);
    else await operation();
  }

  return <section className={`settings-card sheets-card data-task-card ${embedded ? 'is-embedded' : ''}`} {...(embedded ? { 'aria-label': t('googleSettings.exportTitle') } : { 'aria-labelledby': 'sheets-title' })}>
    {!embedded && <div className="settings-card-heading"><div><h2 id="sheets-title">{t('googleSettings.exportTitle')}</h2><p>{t('googleSettings.exportDescription')}</p></div><span className={`connection-status status-${settings.status.toLowerCase()}`}>{statusLabel(settings.status, t)}</span></div>}
    {!googleConnected && <p className="settings-step-notice">{t('googleSettings.googleAccessNotice')}</p>}
    <GooglePickerButton label={t('googleSettings.chooseOrdersSheet')} connected={googleConnected} intent="orders" autoOpen={autoOpenPicker} disabled={pending} onSelected={(selection) => void selectSpreadsheet(selection)} />
    {spreadsheetId && <div className="data-selection-summary"><span>{t('googleSettings.sheetSelected')}</span><strong>{sheetName || t('googleSettings.selectTab')}</strong></div>}
    {tabs.length > 1 && <label className="data-tab-choice"><span>{t('googleSettings.ordersDestination')}</span><select aria-label={t('googleSettings.tabName')} value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{tabs.map((tab) => <option key={tab.sheetId} value={tab.title}>{tab.title}</option>)}</select></label>}
    <div className="settings-actions">{spreadsheetId && tabs.length !== 1 && <LoadingButton pending={pending} pendingLabel={t('googleSettings.saving')} disabled={!sheetName.trim()} onClick={() => void saveDestination()} type="button">{t('googleSettings.saveConnection')}</LoadingButton>}<LoadingButton className="text-button" pending={pending} pendingLabel={t('googleSettings.validating')} disabled={settings.status === 'NOT_CONFIGURED'} onClick={() => void validateDestination()} type="button">{t('googleSettings.validate')}</LoadingButton>{message && <span className="save-success">{message}</span>}{error && <span className="save-error" role="alert">{error}</span>}</div>
  </section>;
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']) { return ({ ACTIVE: t('googleSettings.active'), PENDING: t('googleSettings.pending'), INVALID_HEADERS: t('googleSettings.missingColumns'), ERROR: t('googleSettings.error'), NOT_CONFIGURED: t('googleSettings.notConfigured') } as Record<string, string>)[status] ?? status; }
