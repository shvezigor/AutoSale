'use client';

import { useState } from 'react';

import { CatalogueSourceSettings, type CatalogueSourceConfiguration, type CatalogueSourceHealth } from './catalogue-source-settings';
import { GoogleSheetsSettingsForm, type GoogleSheetsSettings } from './google-sheets-settings-form';
import { useI18n } from '../i18n/i18n-provider';

type DataIntegrationId = 'catalogue' | 'orders-export';

export function DataIntegrationHub({
  sources,
  configurations,
  sheets,
  googleConnected,
  autoOpenCatalogue = false,
  autoOpenOrders = false,
}: {
  sources: CatalogueSourceHealth[];
  configurations: CatalogueSourceConfiguration[];
  sheets: GoogleSheetsSettings;
  googleConnected: boolean;
  autoOpenCatalogue?: boolean;
  autoOpenOrders?: boolean;
}) {
  const { t } = useI18n();
  const [catalogue, setCatalogue] = useState<CatalogueSourceConfiguration | null>(configurations[0] ?? null);
  const [orders, setOrders] = useState(sheets);
  const [open, setOpen] = useState<DataIntegrationId | null>(autoOpenCatalogue ? 'catalogue' : autoOpenOrders ? 'orders-export' : null);
  const integrations = [
    {
      id: 'catalogue' as const,
      name: t('settings.catalogueIntegration'), description: t('settings.catalogueIntegrationDescription'),
      status: catalogue?.status ?? 'NOT_CONFIGURED',
      content: <CatalogueSourceSettings embedded role="OWNER" sources={sources} configurations={configurations} googleConnected={googleConnected} autoOpenPicker={autoOpenCatalogue} onConfigurationChange={setCatalogue} />,
    },
    {
      id: 'orders-export' as const,
      name: t('settings.ordersExport'), description: t('settings.ordersExportDescription'),
      status: orders.status,
      content: <GoogleSheetsSettingsForm embedded initial={sheets} googleConnected={googleConnected} autoOpenPicker={autoOpenOrders} onSettingsChange={setOrders} />,
    },
  ];
  const connectedCount = integrations.filter((integration) => integration.status === 'ACTIVE').length;

  return <div className="delivery-carrier-hub data-integration-hub" aria-label={t('settings.integrationsLabel')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: connectedCount, total: integrations.length })}</strong>
      <p>{t('settings.openIntegration')}</p>
    </div>
    <div className="delivery-carrier-list">
      {integrations.map((integration) => {
        const expanded = open === integration.id;
        const buttonId = `data-integration-${integration.id}`;
        const panelId = `${buttonId}-panel`;
        return <section key={integration.id} className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
          <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : integration.id)}>
            <span className={`delivery-carrier-mark data-${integration.id}`} aria-hidden="true">{integration.id === 'catalogue' ? 'ТВ' : 'ЕК'}</span>
            <span className="delivery-carrier-copy"><strong>{integration.name}</strong><small>{integration.description}</small></span>
            <span className={`connection-status ${statusClass(integration.status)}`}>{statusLabel(integration.status, t)}</span>
            <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          {expanded && <div id={panelId} className="delivery-carrier-panel" role="region" aria-labelledby={buttonId}>{integration.content}</div>}
        </section>;
      })}
    </div>
  </div>;
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>['t']): string {
  return ({
    ACTIVE: t('settings.active'), PENDING: t('settings.pending'), PAUSED: t('settings.paused'), ERROR: t('settings.error'),
    INVALID_HEADERS: t('settings.invalidHeaders'), DISCONNECTED: t('settings.disconnected'), NOT_CONFIGURED: t('settings.notConfigured'),
  } as Record<string, string>)[status] ?? status;
}

function statusClass(status: string): string {
  if (status === 'ACTIVE') return 'status-active';
  if (status === 'ERROR' || status === 'INVALID_HEADERS') return 'status-error';
  if (status === 'PENDING') return 'status-pending';
  return 'status-not_connected';
}
