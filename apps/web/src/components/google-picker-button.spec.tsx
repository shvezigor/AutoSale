import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { cleanup(); mutatingFetch.mockReset(); });

describe('GooglePickerButton', () => {
  it('translates picker feedback while preserving the selected file name', async () => {
    const pickerLauncher = vi.fn().mockResolvedValue({ fileId: 'sheet-a', name: 'Каталог' });
    render(<I18nProvider locale="en" authenticated={false}><GooglePickerButton onSelected={vi.fn()} pickerLauncher={pickerLauncher} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Google spreadsheet' }));
    expect(await screen.findByText('Selected: Каталог')).toBeInTheDocument();
  });
  it('starts incremental Google authorization from the same picker action', async () => {
    mutatingFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ authorizationUrl: 'https://accounts.google.com/o/oauth2/auth' }) });
    const navigate = vi.fn();
    render(<GooglePickerButton connected={false} intent="catalogue" navigate={navigate} onSelected={vi.fn()} pickerLauncher={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google-таблицю' }));
    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledWith('/api/integrations/google/connect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ returnPath: '/settings?tab=data&action=pick-catalogue' }),
    })));
    expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
  });

  it('shows loading and returns a selected file without a refresh token', async () => {
    let resolveSelection!: (selection: GooglePickerSelection) => void;
    const pickerLauncher = vi.fn(() => new Promise<GooglePickerSelection | null>((resolve) => { resolveSelection = resolve; }));
    const onSelected = vi.fn();
    render(<GooglePickerButton onSelected={onSelected} pickerLauncher={pickerLauncher} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google-таблицю' }));
    expect(screen.getByRole('button', { name: 'Відкриваємо Google…' })).toBeDisabled();
    resolveSelection({ fileId: 'sheet-a', name: 'Каталог' });

    await waitFor(() => expect(onSelected).toHaveBeenCalledWith({ fileId: 'sheet-a', name: 'Каталог' }));
    expect(screen.getByText('Обрано: Каталог')).toBeInTheDocument();
    expect(JSON.stringify(onSelected.mock.calls)).not.toContain('refresh');
  });

  it('treats cancellation as a safe no-op and exposes provider errors', async () => {
    const onSelected = vi.fn();
    const { rerender } = render(<GooglePickerButton onSelected={onSelected} pickerLauncher={vi.fn().mockResolvedValue(null)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google-таблицю' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обрати Google-таблицю' })).toBeEnabled());
    expect(onSelected).not.toHaveBeenCalled();

    rerender(<GooglePickerButton onSelected={onSelected} pickerLauncher={vi.fn().mockRejectedValue(new Error('provider'))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google-таблицю' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося відкрити Google Picker'));
  });
});
