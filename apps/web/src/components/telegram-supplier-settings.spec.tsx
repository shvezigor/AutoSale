import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivityProvider } from './activity-provider';
import { TelegramSupplierSettings } from './telegram-supplier-settings';
import { ToastProvider } from './toast-provider';

const initial = {
  businessConnected: true,
  selectedDestinationId: null,
  autoDispatch: false,
  destinations: [{
    id: '11111111-1111-4111-8111-111111111111', title: 'Постачальник', route: 'BUSINESS' as const,
    lastObservedAt: '2026-09-09T12:00:00.000Z',
  }],
};
const destinationId = '11111111-1111-4111-8111-111111111111';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TelegramSupplierSettings', () => {
  it('lets the owner select and save an observed supplier chat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...initial, selectedDestinationId: destinationId }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ToastProvider><ActivityProvider><TelegramSupplierSettings initial={initial} /></ActivityProvider></ToastProvider>);

    fireEvent.change(screen.getByLabelText('Чат постачальника'), { target: { value: destinationId } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти постачальника' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/integrations/telegram/supplier', expect.objectContaining({ method: 'PUT' })));
    expect((await screen.findAllByText('Постачальника збережено')).length).toBeGreaterThan(0);
  });

  it('explains how a Business chat becomes available', () => {
    render(<ToastProvider><ActivityProvider><TelegramSupplierSettings initial={{ ...initial, businessConnected: false, destinations: [] }} /></ActivityProvider></ToastProvider>);
    expect(screen.getByText('Telegram Business')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Додати резервну групу' })).toBeInTheDocument();
  });
});
