import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeliveryLocationPicker } from './delivery-location-picker';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DeliveryLocationPicker', () => {
  it('debounces search, supports keyboard selection and retains the exact ref separately', async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const search = vi.fn().mockResolvedValue([
      { ref: 'city-ref', provider: 'NOVA_POSHTA', type: 'CITY', label: 'Луцьк' },
      { ref: 'city-ref-2', provider: 'NOVA_POSHTA', type: 'CITY', label: 'Луцьк, район' },
    ]);
    render(<DeliveryLocationPicker label="Місто" type="CITY" value={null} onSelect={onSelect} search={search} />);
    const input = screen.getByRole('combobox', { name: 'Місто' });
    fireEvent.change(input, { target: { value: 'Луцьк' } });
    expect(search).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(search).toHaveBeenCalledWith({ provider: 'NOVA_POSHTA', type: 'CITY', query: 'Луцьк', cityRef: undefined }, expect.any(AbortSignal));
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ ref: 'city-ref' }));
  });

  it('clears a stale branch selection when its city changes', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<DeliveryLocationPicker label="Відділення" type="BRANCH" cityRef="city-a" value={{ ref: 'branch-ref', provider: 'NOVA_POSHTA', type: 'BRANCH', label: '№1', cityRef: 'city-a' }} onSelect={onSelect} />);
    rerender(<DeliveryLocationPicker label="Відділення" type="BRANCH" cityRef="city-b" value={{ ref: 'branch-ref', provider: 'NOVA_POSHTA', type: 'BRANCH', label: '№1', cityRef: 'city-a' }} onSelect={onSelect} />);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it('searches the explicitly selected Meest directory', async () => {
    const search = vi.fn().mockResolvedValue([
      { ref: 'meest-city', provider: 'MEEST', type: 'CITY', label: 'Луцьк' },
    ]);
    render(<DeliveryLocationPicker provider="MEEST" label="Місто Meest" type="CITY" value={null} onSelect={vi.fn()} search={search} />);
    fireEvent.change(screen.getByLabelText('Місто Meest'), { target: { value: 'Луцьк' } });

    await waitFor(() => expect(search).toHaveBeenCalledWith(
      { provider: 'MEEST', type: 'CITY', query: 'Луцьк', cityRef: undefined },
      expect.any(AbortSignal),
    ));
  });

  it('shows stable loading, empty and error states and closes with Escape', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const search = vi.fn().mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(<DeliveryLocationPicker label="Місто" type="CITY" value={null} onSelect={vi.fn()} search={search} />);
    const input = screen.getByRole('combobox', { name: 'Місто' });
    fireEvent.change(input, { target: { value: 'Луцьк' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText('Шукаємо…')).toBeInTheDocument();
    await act(async () => reject(new Error('network')));
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося завантажити');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
