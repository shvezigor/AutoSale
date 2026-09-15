'use client';

import type { DeliveryConnectionSummary, MeestConnectionSummary, UkrposhtaConnectionSummary } from '../../../../packages/contracts/src/delivery';
import { useState } from 'react';

import { DeliverySettingsCard, type DeliverySettingsSummary } from './delivery-settings-card';
import { MeestSettingsCard, type MeestSettingsSummary } from './meest-settings-card';
import { UkrposhtaSettingsCard, type UkrposhtaSettingsSummary } from './ukrposhta-settings-card';
import { useI18n } from '../i18n/i18n-provider';

type CarrierId = 'nova-poshta' | 'meest' | 'ukrposhta';

export function DeliveryCarrierHub({ delivery, meest, ukrposhta, role }: {
  delivery: DeliverySettingsSummary;
  meest: MeestSettingsSummary;
  ukrposhta: UkrposhtaSettingsSummary;
  role: 'OWNER' | 'MANAGER';
}) {
  const { t } = useI18n();
  const [novaConnection, setNovaConnection] = useState<DeliveryConnectionSummary | null>(delivery.connections.find((item) => item.provider === 'NOVA_POSHTA') ?? null);
  const [meestConnection, setMeestConnection] = useState<MeestConnectionSummary | null>(meest.connection);
  const [ukrposhtaConnection, setUkrposhtaConnection] = useState<UkrposhtaConnectionSummary | null>(ukrposhta.connection);
  const [open, setOpen] = useState<CarrierId | null>(null);

  const carriers = [
    delivery.enabled ? {
      id: 'nova-poshta' as const,
      name: t('orders.novaPoshta'), description: t('settings.novaPoshtaDescription'),
      status: novaConnection?.status,
      content: <DeliverySettingsCard embedded initial={{ ...delivery, connections: novaConnection ? [novaConnection] : [] }} role={role} onConnectionChange={setNovaConnection} />,
    } : null,
    meest.enabled ? {
      id: 'meest' as const,
      name: 'Meest',
      description: t('settings.meestDescription'),
      status: meestConnection?.status,
      content: <MeestSettingsCard embedded initial={{ ...meest, connection: meestConnection }} role={role} onConnectionChange={setMeestConnection} />,
    } : null,
    ukrposhta.enabled ? {
      id: 'ukrposhta' as const,
      name: t('orders.ukrposhta'), description: t('settings.ukrposhtaDescription'),
      status: ukrposhtaConnection?.status,
      content: <UkrposhtaSettingsCard embedded initial={{ ...ukrposhta, connection: ukrposhtaConnection }} role={role} onConnectionChange={setUkrposhtaConnection} />,
    } : null,
  ].filter((carrier): carrier is NonNullable<typeof carrier> => carrier !== null);

  return <div className="delivery-carrier-hub" aria-label={t('settings.carriers')}>
    <div className="delivery-hub-summary">
      <span>{t('settings.connected')}</span>
      <strong>{t('settings.connectedCount', { connected: carriers.filter((carrier) => carrier.status === 'ACTIVE').length, total: carriers.length })}</strong>
      <p>{t('settings.openCarrier')}</p>
    </div>
    <div className="delivery-carrier-list">
      {carriers.map((carrier) => {
        const expanded = open === carrier.id;
        const buttonId = `delivery-carrier-${carrier.id}`;
        const panelId = `${buttonId}-panel`;
        return <section key={carrier.id} className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
          <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : carrier.id)}>
            <span className={`delivery-carrier-mark carrier-${carrier.id}`} aria-hidden="true">{carrierMark(carrier.id, t)}</span>
            <span className="delivery-carrier-copy"><strong>{carrier.name}</strong><small>{carrier.description}</small></span>
            <span className={`connection-status status-${(carrier.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(carrier.status, t)}</span>
            <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          {expanded && <div id={panelId} className="delivery-carrier-panel" role="region" aria-labelledby={buttonId}>{carrier.content}</div>}
        </section>;
      })}
    </div>
  </div>;
}

function statusLabel(status: DeliveryConnectionSummary['status'] | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (!status || status === 'DISCONNECTED') return t('settings.notConnected');
  if (status === 'NEEDS_ATTENTION') return t('settings.needsAttention');
  return t('settings.active');
}

function carrierMark(id: CarrierId, t: ReturnType<typeof useI18n>['t']): string {
  if (id === 'nova-poshta') return t('settings.novaPoshtaMark');
  if (id === 'ukrposhta') return t('settings.ukrposhtaMark');
  return 'M';
}
