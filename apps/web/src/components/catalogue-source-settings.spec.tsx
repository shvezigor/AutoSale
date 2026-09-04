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
  serviceAccountEmail: null, authorizationAction: 'GOOGLE_OAUTH', syncSchedule: 'MANUAL' as const,
};

afterEach(() => { cleanup(); mutatingFetch.mockReset(); vi.unstubAllGlobals(); });

describe('CatalogueSourceSettings', () => {
  it('presents Google Sheets and local file as the two product source actions', () => {
    render(<CatalogueSourceSettings role="OWNER" sources={[]} configurations={[]} />);
    expect(screen.getByRole('heading', { name: 'Товари' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обрати Google-таблицю' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завантажити CSV або Excel' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Google таблиця')).not.toBeInTheDocument();
  });

  it('uploads a local catalogue into the existing import pipeline', async () => {
    mutatingFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'UPLOADED' }) });
    render(<CatalogueSourceSettings role="OWNER" sources={[]} configurations={[]} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['Name,Price\nСукня,1200'], 'products.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/catalogue/imports/upload', expect.objectContaining({ method: 'POST', body: expect.any(FormData) })));
    expect(await screen.findByText(/AutoSale розпізнає колонки/)).toBeInTheDocument();
  });

  it('shows managers only health without tenant data actions', () => {
    render(<CatalogueSourceSettings role="MANAGER" sources={[source]} configurations={[configuration]} />);
    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('sheet-id')).not.toBeInTheDocument();
  });
});
