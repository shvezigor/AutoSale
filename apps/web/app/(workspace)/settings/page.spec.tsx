import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch, getServerSession } = vi.hoisted(() => ({
  authenticatedApiFetch: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('../../../src/auth/session', () => ({ authenticatedApiFetch, getServerSession }));
vi.mock('next/navigation', () => ({ usePathname: () => '/settings', useRouter: () => ({ refresh: vi.fn() }) }));

import SettingsPage from './page';
import WorkspaceLayout from '../layout';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  authenticatedApiFetch.mockReset();
  getServerSession.mockReset();
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('groups catalogue and order destinations in the Data section', async () => {
    getServerSession.mockResolvedValue({
      userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
      email: 'owner@example.com',
      name: 'Олена',
      platformRole: 'USER',
      tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
      membershipRole: 'OWNER',
    });
    authenticatedApiFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'DISCONNECTED', accountId: null, username: null, tokenExpiresAt: null, lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE', cleanupErrorCode: null, cleanupAbandonEligible: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ACTIVE', email: 'owner@gmail.com', grantedScopes: ['drive.file'], connectedAt: '2026-09-01T08:00:00.000Z', lastVerifiedAt: '2026-09-01T08:00:00.000Z', lastErrorCode: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ available: true, botUsername: 'AutoSaleBot', personal: { connected: false, displayName: null, username: null, linkedAt: null } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ORDER_NEEDS_REVIEW: true, ORDER_AUTO_APPROVED: true, SUPPLIER_DELIVERY_FAILED: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connections: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connection: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connection: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ businessConnected: true, selectedDestinationId: null, autoDispatch: false, destinations: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ approvalMode: 'REVIEW', minimumConfidence: 0.8, promptVersion: 'v1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог Google Sheets', status: 'PENDING', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z' }]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог Google Sheets', status: 'PENDING', lastSyncedAt: null, lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z', spreadsheetId: 'sheet-id', sheetName: 'Товари', syncSchedule: 'DAILY', serviceAccountEmail: 'autosale@example.iam.gserviceaccount.com', authorizationAction: 'SHARE_SPREADSHEET' }) });

    render(await WorkspaceLayout({ children: await SettingsPage({ searchParams: Promise.resolve({ tab: 'telegram' }) }) }));

    expect(screen.getByRole('tablist', { name: 'Розділи налаштувань' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.querySelector('span')?.textContent)).toEqual([
      'Дані', 'Соцмережі / клієнти', 'Замовлення', 'Постачальники', 'Доставка', 'Сповіщення',
    ]);
    expect(screen.getByRole('tab', { name: /Соцмережі \/ клієнти/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /Сповіщення/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Постачальники/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Доставка/ })).toBeInTheDocument();
    const telegramChannel = screen.getByRole('button', { name: /Telegram.*Особисті сповіщення/i });
    expect(telegramChannel).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Telegram' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Постачальник' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google Sheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підтвердження замовлень' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Дані/ }));

    const catalogueIntegration = screen.getByRole('button', { name: /Товари.*Каталог/i });
    const ordersIntegration = screen.getByRole('button', { name: /Експорт замовлень.*таблицю/i });
    expect(catalogueIntegration).toHaveAttribute('aria-expanded', 'false');
    expect(ordersIntegration).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Обрати Google-таблицю' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обрати таблицю для замовлень' })).not.toBeInTheDocument();

    fireEvent.click(catalogueIntegration);
    expect(catalogueIntegration).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Обрати Google-таблицю' })).toBeInTheDocument();

    fireEvent.click(ordersIntegration);
    expect(catalogueIntegration).toHaveAttribute('aria-expanded', 'false');
    expect(ordersIntegration).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('button', { name: 'Обрати Google-таблицю' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обрати таблицю для замовлень' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Google-акаунт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підключення каналів' })).not.toBeInTheDocument();
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/catalogue/sources/44444444-4444-4444-8444-444444444444');
    fireEvent.click(screen.getByRole('tab', { name: /Сповіщення/ }));
    fireEvent.click(screen.getByRole('button', { name: /Telegram.*Особисті сповіщення/i }));
    expect(screen.getByRole('region', { name: 'Telegram' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Постачальник' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Постачальники/ }));
    expect(screen.getByRole('heading', { name: 'Постачальник' })).toBeInTheDocument();
  });

  it('shows a manager only the safe Instagram connection card', async () => {
    getServerSession.mockResolvedValue({
      userId: '3e6855ae-48a2-4d4d-8c39-5bf7d10f1a03',
      email: 'manager@example.com',
      name: 'Іван',
      platformRole: 'USER',
      tenantId: '1f713392-fdbc-4e3c-9824-db207934bff4',
      membershipRole: 'MANAGER',
    });
    authenticatedApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
        status: 'ACTIVE',
        accountId: '17841400000000000',
        username: 'autosale_store',
        tokenExpiresAt: null,
        lastVerifiedAt: '2026-08-28T12:00:00.000Z',
        lastErrorCode: null,
        cleanupStatus: 'NONE',
        cleanupErrorCode: null,
        cleanupAbandonEligible: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ACTIVE', email: null, grantedScopes: [], connectedAt: null, lastVerifiedAt: null, lastErrorCode: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ available: true, botUsername: 'AutoSaleBot', personal: { connected: true, displayName: 'Іван', username: 'ivan_manager', linkedAt: '2026-09-01T08:00:00.000Z' } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ORDER_NEEDS_REVIEW: true, ORDER_AUTO_APPROVED: true, SUPPLIER_DELIVERY_FAILED: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connections: [{ provider: 'NOVA_POSHTA', status: 'ACTIVE', accountLabel: 'ТОВ Приклад', lastVerifiedAt: null, lastErrorCode: null, senderProfile: null }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connection: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, connection: null }) });

    render(await WorkspaceLayout({ children: await SettingsPage() }));

    expect(authenticatedApiFetch).toHaveBeenCalledTimes(7);
    expect(screen.getByRole('tab', { name: /Дані/ })).toHaveAttribute('aria-selected', 'true');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/instagram');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/google');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/telegram');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/telegram/preferences');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/delivery');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/delivery/meest');
    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/integrations/delivery/ukrposhta');
    fireEvent.click(screen.getByRole('tab', { name: /Соцмережі \/ клієнти/ }));
    expect(screen.getByRole('button', { name: /Instagram.*Активне/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('@autosale_store')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Instagram.*Активне/ }));
    expect(screen.getByText('@autosale_store')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Підтвердження замовлень' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Дані/ }));
    expect(screen.getByRole('heading', { name: 'Дані та синхронізація' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Instagram/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Постачальники/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Сповіщення/ }));
    fireEvent.click(screen.getByRole('button', { name: /Telegram.*Особисті сповіщення/i }));
    expect(screen.getByText('@ivan_manager')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Доставка/ }));
    expect(screen.getByRole('button', { name: /Нова Пошта/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Укрпошта/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ТОВ Приклад')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API-ключ Нової Пошти')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Нова Пошта/ }));
    expect(screen.getByText('ТОВ Приклад')).toBeInTheDocument();
  });
});
