import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from './toast-provider';

function Harness() {
  const toast = useToast();
  return <><button onClick={() => toast.show({ type: 'success', title: 'Готово' })}>Success</button><button onClick={() => toast.show({ type: 'error', title: 'Помилка' })}>Error</button></>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ToastProvider', () => {
  it('dismisses success after five seconds', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Success' }));
    expect(screen.getByRole('status')).toHaveTextContent('Готово');
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText('Готово')).not.toBeInTheDocument();
  });

  it('keeps errors until the user closes them', () => {
    render(<ToastProvider><Harness /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Помилка');
    fireEvent.click(screen.getByRole('button', { name: 'Закрити сповіщення' }));
    expect(screen.queryByText('Помилка')).not.toBeInTheDocument();
  });
});
