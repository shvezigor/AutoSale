import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GooglePickerButton, type GooglePickerSelection } from './google-picker-button';

afterEach(cleanup);

describe('GooglePickerButton', () => {
  it('stays disabled while Google is disconnected', () => {
    render(<GooglePickerButton disabled onSelected={vi.fn()} pickerLauncher={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Обрати Google таблицю' })).toBeDisabled();
  });

  it('shows loading and returns a selected file without a refresh token', async () => {
    let resolveSelection!: (selection: GooglePickerSelection) => void;
    const pickerLauncher = vi.fn(() => new Promise<GooglePickerSelection | null>((resolve) => { resolveSelection = resolve; }));
    const onSelected = vi.fn();
    render(<GooglePickerButton onSelected={onSelected} pickerLauncher={pickerLauncher} />);

    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google таблицю' }));
    expect(screen.getByRole('button', { name: 'Відкриваємо Google…' })).toBeDisabled();
    resolveSelection({ fileId: 'sheet-a', name: 'Каталог' });

    await waitFor(() => expect(onSelected).toHaveBeenCalledWith({ fileId: 'sheet-a', name: 'Каталог' }));
    expect(screen.getByText('Обрано: Каталог')).toBeInTheDocument();
    expect(JSON.stringify(onSelected.mock.calls)).not.toContain('refresh');
  });

  it('treats cancellation as a safe no-op and exposes provider errors', async () => {
    const onSelected = vi.fn();
    const { rerender } = render(<GooglePickerButton onSelected={onSelected} pickerLauncher={vi.fn().mockResolvedValue(null)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google таблицю' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обрати Google таблицю' })).toBeEnabled());
    expect(onSelected).not.toHaveBeenCalled();

    rerender(<GooglePickerButton onSelected={onSelected} pickerLauncher={vi.fn().mockRejectedValue(new Error('provider'))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати Google таблицю' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося відкрити Google Picker'));
  });
});
