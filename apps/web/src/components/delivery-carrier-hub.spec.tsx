import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./delivery-settings-card', () => ({
  DeliverySettingsCard: ({ embedded }: { embedded?: boolean }) => <div>Налаштування Нової пошти {embedded ? 'в панелі' : ''}</div>,
}));
vi.mock('./meest-settings-card', () => ({
  MeestSettingsCard: ({ embedded }: { embedded?: boolean }) => <div>Налаштування Meest {embedded ? 'в панелі' : ''}</div>,
}));
vi.mock('./ukrposhta-settings-card', () => ({
  UkrposhtaSettingsCard: ({ embedded }: { embedded?: boolean }) => <div>Налаштування Укрпошти {embedded ? 'в панелі' : ''}</div>,
}));

import { DeliveryCarrierHub } from './delivery-carrier-hub';
import type { DeliverySettingsSummary } from './delivery-settings-card';
import type { MeestSettingsSummary } from './meest-settings-card';
import type { UkrposhtaSettingsSummary } from './ukrposhta-settings-card';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const nova: DeliverySettingsSummary = {
  enabled: true,
  connections: [{ provider: 'NOVA_POSHTA', status: 'ACTIVE', accountLabel: 'ТОВ Приклад', lastVerifiedAt: null, lastErrorCode: null, senderProfile: null }],
};
const meest: MeestSettingsSummary = { enabled: true, connection: null };
const ukrposhta: UkrposhtaSettingsSummary = { enabled: true, connection: null };

afterEach(cleanup);

describe('DeliveryCarrierHub', () => {
  it('translates the carrier hub while keeping provider brands intact', () => {
    render(<I18nProvider locale="en" authenticated={false}><DeliveryCarrierHub delivery={nova} meest={meest} ukrposhta={ukrposhta} role="OWNER" /></I18nProvider>);
    expect(screen.getByLabelText('Carriers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nova Poshta.*TTNs/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Meest.*Cities/ })).toBeInTheDocument();
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
  });
  it('starts with every carrier closed, then opens one carrier at a time', () => {
    render(<DeliveryCarrierHub delivery={nova} meest={meest} ukrposhta={ukrposhta} role="OWNER" />);

    expect(screen.getByRole('button', { name: /Нова Пошта/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Meest/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Укрпошта/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Налаштування Нової пошти в панелі')).not.toBeInTheDocument();
    expect(screen.queryByText('Налаштування Meest в панелі')).not.toBeInTheDocument();
    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.getAllByText('Не підключено')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Meest/ }));

    expect(screen.getByRole('button', { name: /Нова Пошта/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Meest/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Налаштування Нової пошти в панелі')).not.toBeInTheDocument();
    expect(screen.getByText('Налаштування Meest в панелі')).toBeInTheDocument();
  });

  it('omits carriers that are disabled for the deployment', () => {
    render(<DeliveryCarrierHub delivery={{ enabled: false, connections: [] }} meest={meest} ukrposhta={ukrposhta} role="MANAGER" />);

    expect(screen.queryByRole('button', { name: /Нова Пошта/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Meest/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
