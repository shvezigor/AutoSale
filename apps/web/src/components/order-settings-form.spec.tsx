import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderSettingsForm } from './order-settings-form';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('OrderSettingsForm', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('saves the selected approval mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ToastProvider><ActivityProvider><OrderSettingsForm
        initial={{
          approvalMode: 'ALWAYS',
          autoApprovalThreshold: 0.9,
          promptVersion: 'instagram-order-v1',
          triggerPhrases: ['беремо замовлення в роботу'],
        }}
      /></ActivityProvider></ToastProvider>,
    );

    fireEvent.click(screen.getByLabelText('Без підтвердження'));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/settings/orders',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ approvalMode: 'NEVER' }),
          headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
        }),
      ),
    );
    expect((await screen.findAllByText('Налаштування збережено')).length).toBeGreaterThan(0);
  });
});
  it('translates approval settings while preserving the prompt version', () => {
    render(<I18nProvider locale="en" authenticated={false}><ToastProvider><ActivityProvider><OrderSettingsForm initial={{ approvalMode: 'ALWAYS', autoApprovalThreshold: 0.9, promptVersion: 'instagram-order-v1', triggerPhrases: [] }} /></ActivityProvider></ToastProvider></I18nProvider>);
    expect(screen.getByRole('heading', { name: 'Order approval' })).toBeInTheDocument();
    expect(screen.getByLabelText('No approval required')).toBeInTheDocument();
    expect(screen.getByText('instagram-order-v1')).toBeInTheDocument();
  });
