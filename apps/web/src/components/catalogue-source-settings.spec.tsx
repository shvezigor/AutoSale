import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));
vi.mock('./google-picker-button', () => ({
  GooglePickerButton: ({ label = 'Обрати Google-таблицю', onSelected }: { label?: string; onSelected: (selection: { fileId: string; name: string }) => void }) =>
    <button type="button" onClick={() => onSelected({ fileId: 'sheet-new', name: 'Мої товари' })}>{label}</button>,
}));

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

  it('starts synchronization immediately after a Google table is saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ spreadsheetId: 'sheet-new', tabs: [{ sheetId: 1, title: 'Товари' }] }) }));
    mutatingFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...configuration, id: 'source-new', spreadsheetId: 'sheet-new', displayName: 'Мої товари' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ queued: true }) });
    render(<CatalogueSourceSettings role="OWNER" sources={[]} configurations={[]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google-таблицю' }));
    await screen.findByText(/Таблицю розпізнано/);
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити товари' }));

    await waitFor(() => expect(mutatingFetch).toHaveBeenLastCalledWith('/api/catalogue/sources/source-new/sync', { method: 'POST' }));
  });

  it('shows a concise completion summary and no preview for a completed import', () => {
    render(<CatalogueSourceSettings role="OWNER" sources={[source]} configurations={[{
      ...configuration,
      latestRun: { id: 'run-1', status: 'COMPLETED', createdRows: 12, updatedRows: 3, skippedRows: 1, failedRows: 0 },
    }]} />);
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(screen.getByText('Додано: 12 · оновлено: 3 · пропущено: 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Перевірити/ })).not.toBeInTheDocument();
  });

  it('offers review only when the latest import is uncertain', () => {
    render(<CatalogueSourceSettings role="OWNER" sources={[source]} configurations={[{
      ...configuration,
      latestRun: { id: 'run-review', status: 'MAPPING_REVIEW', createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0 },
    }]} />);
    expect(screen.getByText('Потрібна перевірка')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перевірити сумнівні поля' })).toHaveAttribute('href', '/catalogue?review=run-review');
  });

  it('shows managers only health without tenant data actions', () => {
    render(<CatalogueSourceSettings role="MANAGER" sources={[source]} configurations={[configuration]} />);
    expect(screen.getByText('Активне')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('sheet-id')).not.toBeInTheDocument();
  });
});
