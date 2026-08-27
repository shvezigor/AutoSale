import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleSheetsSettingsForm } from './google-sheets-settings-form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GoogleSheetsSettingsForm', () => {
  it('saves and validates a destination without collecting credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ spreadsheetId: 'sheet123', sheetName: 'Продажі', status: 'PENDING', requiredHeaders: ['order_id'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token-2' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, missingHeaders: [], status: 'ACTIVE' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<GoogleSheetsSettingsForm initial={{ spreadsheetId: null, sheetName: 'Orders', status: 'NOT_CONFIGURED', requiredHeaders: ['order_id'], lastValidatedAt: null, errorSummary: null }} />);

    fireEvent.change(screen.getByLabelText('ID Google таблиці'), { target: { value: 'sheet123' } });
    fireEvent.change(screen.getByLabelText('Назва вкладки'), { target: { value: 'Продажі' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти Google Sheets' }));
    await waitFor(() => expect(screen.getByText('Конфігурацію збережено')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Перевірити доступ' }));
    await waitFor(() => expect(screen.getByText('Підключення активне')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/google-sheets', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }) }));
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/google-sheets/validate', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token-2' }) }));
    expect(screen.queryByLabelText(/private key/i)).not.toBeInTheDocument();
  });
});
