import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { CatalogueSourceSettings } from './catalogue-source-settings';

const source = {
  id: '44444444-4444-4444-8444-444444444444', type: 'GOOGLE_SHEETS', displayName: 'Каталог', status: 'ACTIVE',
  lastSyncedAt: '2026-09-01T08:00:00.000Z', lastErrorSummary: null, updatedAt: '2026-09-01T08:00:00.000Z',
};
const configuration = {
  ...source, spreadsheetId: 'sheet-id', sheetName: 'Товари',
  serviceAccountEmail: 'reader@example.iam.gserviceaccount.com', authorizationAction: 'SHARE_WITH_SERVICE_ACCOUNT',
  syncSchedule: 'MANUAL' as const,
};

afterEach(() => { cleanup(); mutatingFetch.mockReset(); });

describe('CatalogueSourceSettings', () => {
  it('lets an owner save a tab and schedule, test access, and synchronize now without collecting credentials', async () => {
    mutatingFetch
      .mockResolvedValueOnce(response({ ...configuration, syncSchedule: 'HOURLY' }))
      .mockResolvedValueOnce(response({ connected: true, headers: ['SKU', 'Name'], fingerprint: 'fingerprint' }))
      .mockResolvedValueOnce(response({ queued: true, sourceId: source.id }));
    render(<CatalogueSourceSettings role="OWNER" sources={[source]} configuration={configuration} />);

    fireEvent.change(screen.getByLabelText('Розклад синхронізації'), { target: { value: 'HOURLY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти джерело' }));
    await waitFor(() => expect(screen.getByText('Джерело збережено')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Перевірити доступ' }));
    await waitFor(() => expect(screen.getByText('Доступ підтверджено')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Синхронізувати зараз' }));
    await waitFor(() => expect(screen.getByText('Синхронізацію заплановано')).toBeInTheDocument());

    expect(mutatingFetch).toHaveBeenCalledWith(`/api/catalogue/sources/${source.id}`, expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"syncSchedule":"HOURLY"') }));
    expect(mutatingFetch).toHaveBeenCalledWith(`/api/catalogue/sources/${source.id}/check`, { method: 'POST' });
    expect(mutatingFetch).toHaveBeenCalledWith(`/api/catalogue/sources/${source.id}/sync`, { method: 'POST' });
    expect(screen.getByText(/reader@example\.iam\.gserviceaccount\.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/private key|credential|json/i)).not.toBeInTheDocument();
  });

  it('shows a manager only health and last synchronization time', () => {
    render(<CatalogueSourceSettings role="MANAGER" sources={[source]} configuration={null} />);

    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.getByText(/01\.09\.2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Google таблиця/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('sheet-id')).not.toBeInTheDocument();
  });
});

function response(body: unknown) { return { ok: true, json: async () => body }; }
