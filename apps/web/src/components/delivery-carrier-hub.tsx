'use client';

import type { DeliveryConnectionSummary, MeestConnectionSummary, UkrposhtaConnectionSummary } from '../../../../packages/contracts/src/delivery';
import { useMemo, useState } from 'react';

import { DeliverySettingsCard, type DeliverySettingsSummary } from './delivery-settings-card';
import { MeestSettingsCard, type MeestSettingsSummary } from './meest-settings-card';
import { UkrposhtaSettingsCard, type UkrposhtaSettingsSummary } from './ukrposhta-settings-card';

type CarrierId = 'nova-poshta' | 'meest' | 'ukrposhta';

export function DeliveryCarrierHub({ delivery, meest, ukrposhta, role }: {
  delivery: DeliverySettingsSummary;
  meest: MeestSettingsSummary;
  ukrposhta: UkrposhtaSettingsSummary;
  role: 'OWNER' | 'MANAGER';
}) {
  const [novaConnection, setNovaConnection] = useState<DeliveryConnectionSummary | null>(delivery.connections.find((item) => item.provider === 'NOVA_POSHTA') ?? null);
  const [meestConnection, setMeestConnection] = useState<MeestConnectionSummary | null>(meest.connection);
  const [ukrposhtaConnection, setUkrposhtaConnection] = useState<UkrposhtaConnectionSummary | null>(ukrposhta.connection);
  const available = useMemo(() => [
    ...(delivery.enabled ? [{ id: 'nova-poshta' as const, active: novaConnection?.status === 'ACTIVE' }] : []),
    ...(meest.enabled ? [{ id: 'meest' as const, active: meestConnection?.status === 'ACTIVE' }] : []),
    ...(ukrposhta.enabled ? [{ id: 'ukrposhta' as const, active: ukrposhtaConnection?.status === 'ACTIVE' }] : []),
  ], [delivery.enabled, meest.enabled, novaConnection?.status, meestConnection?.status, ukrposhta.enabled, ukrposhtaConnection?.status]);
  const [open, setOpen] = useState<CarrierId | null>(() => available.find((item) => item.active)?.id ?? available[0]?.id ?? null);

  const carriers = [
    delivery.enabled ? {
      id: 'nova-poshta' as const,
      name: 'Нова Пошта',
      description: 'ТТН, відділення, поштомати та відстеження',
      status: novaConnection?.status,
      content: <DeliverySettingsCard embedded initial={{ ...delivery, connections: novaConnection ? [novaConnection] : [] }} role={role} onConnectionChange={setNovaConnection} />,
    } : null,
    meest.enabled ? {
      id: 'meest' as const,
      name: 'Meest',
      description: 'Міста, відділення та дані відправника',
      status: meestConnection?.status,
      content: <MeestSettingsCard embedded initial={{ ...meest, connection: meestConnection }} role={role} onConnectionChange={setMeestConnection} />,
    } : null,
    ukrposhta.enabled ? {
      id: 'ukrposhta' as const,
      name: 'Укрпошта',
      description: 'Бізнес-відправлення та повна історія статусів',
      status: ukrposhtaConnection?.status,
      content: <UkrposhtaSettingsCard embedded initial={{ ...ukrposhta, connection: ukrposhtaConnection }} role={role} onConnectionChange={setUkrposhtaConnection} />,
    } : null,
  ].filter((carrier): carrier is NonNullable<typeof carrier> => carrier !== null);

  return <div className="delivery-carrier-hub" aria-label="Перевізники">
    <div className="delivery-hub-summary">
      <span>Підключено</span>
      <strong>{carriers.filter((carrier) => carrier.status === 'ACTIVE').length} із {carriers.length}</strong>
      <p>Відкрийте перевізника, щоб змінити доступ або дані відправника.</p>
    </div>
    <div className="delivery-carrier-list">
      {carriers.map((carrier) => {
        const expanded = open === carrier.id;
        const buttonId = `delivery-carrier-${carrier.id}`;
        const panelId = `${buttonId}-panel`;
        return <section key={carrier.id} className={`delivery-carrier ${expanded ? 'is-open' : ''}`}>
          <button id={buttonId} className="delivery-carrier-trigger" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen(expanded ? null : carrier.id)}>
            <span className={`delivery-carrier-mark carrier-${carrier.id}`} aria-hidden="true">{carrierMark(carrier.id)}</span>
            <span className="delivery-carrier-copy"><strong>{carrier.name}</strong><small>{carrier.description}</small></span>
            <span className={`connection-status status-${(carrier.status ?? 'NOT_CONNECTED').toLowerCase()}`}>{statusLabel(carrier.status)}</span>
            <svg className="delivery-carrier-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          {expanded && <div id={panelId} className="delivery-carrier-panel" role="region" aria-labelledby={buttonId}>{carrier.content}</div>}
        </section>;
      })}
    </div>
  </div>;
}

function statusLabel(status: DeliveryConnectionSummary['status'] | undefined): string {
  if (!status || status === 'DISCONNECTED') return 'Не підключено';
  if (status === 'NEEDS_ATTENTION') return 'Потрібна увага';
  return 'Активне';
}

function carrierMark(id: CarrierId): string {
  if (id === 'nova-poshta') return 'НП';
  if (id === 'ukrposhta') return 'УП';
  return 'M';
}
