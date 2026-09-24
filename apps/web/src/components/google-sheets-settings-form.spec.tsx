import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./google-picker-button', () => ({
  GooglePickerButton: ({ label, onSelected }: { label: string; onSelected: (selection: { fileId: string; name: string }) => void }) =>
    <button type="button" onClick={() => onSelected({ fileId: 'orders-sheet', name: 'Продажі' })}>{label}</button>,
}));

import { GoogleSheetsSettingsForm } from './google-sheets-settings-form';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderForm(ui: React.ReactElement) { return render(<ToastProvider><ActivityProvider>{ui}</ActivityProvider></ToastProvider>); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GoogleSheetsSettingsForm', () => {
  it('does not expose a raw provider error summary', () => {
    renderForm(<I18nProvider locale="en" authenticated={false}><GoogleSheetsSettingsForm initial={{ spreadsheetId: 'sheet-id', sheetName: 'Orders', status: 'ERROR', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: 'Google API stack trace' }} /></I18nProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Google API stack trace')).not.toBeInTheDocument();
  });

  it('translates export controls while preserving the selected sheet name', () => {
    renderForm(<I18nProvider locale="en" authenticated={false}><GoogleSheetsSettingsForm initial={{ spreadsheetId: 'sheet-id', sheetName: 'Продажі', status: 'ACTIVE', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }} /></I18nProvider>);
    expect(screen.getByRole('heading', { name: 'Order export' })).toBeInTheDocument();
    expect(screen.getByText('Продажі')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument();
  });
  it('uses a business-facing order export card without spreadsheet id input', () => {
    renderForm(<GoogleSheetsSettingsForm initial={{ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }} />);

    expect(screen.getByRole('heading', { name: 'Експорт замовлень' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обрати таблицю для замовлень' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ID Google таблиці')).not.toBeInTheDocument();
  });
  it('saves a selected destination without collecting credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: 'sheet123', sheetName: 'Продажі', status: 'PENDING', requiredHeaders: ['order_id'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token-2' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, missingHeaders: [], status: 'ACTIVE', initialized: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderForm(<GoogleSheetsSettingsForm initial={{ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }} />);

    expect(screen.getByRole('heading', { name: 'Експорт замовлень' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/private key/i)).not.toBeInTheDocument();
  });

  it('automatically saves and validates a spreadsheet with one tab', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: 'orders-sheet', tabs: [{ sheetId: 7, title: 'Замовлення' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-save' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: 'orders-sheet', sheetName: 'Замовлення', status: 'PENDING', requiredHeaders: ['order_id'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-check' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, missingHeaders: [], status: 'ACTIVE', initialized: true }) });
    vi.stubGlobal('fetch', fetchMock);
    renderForm(<GoogleSheetsSettingsForm initial={{ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обрати таблицю для замовлень' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/settings/google-sheets', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ spreadsheetId: 'orders-sheet', sheetName: 'Замовлення' }) })));
    await waitFor(() => expect(screen.getByText('Шаблон Sales AITO створено. Експорт активний.')).toBeInTheDocument());
  });
});
