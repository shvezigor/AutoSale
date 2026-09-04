import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderSettingsForm } from './order-settings-form';
import { ActivityProvider } from './activity-provider';
import { ToastProvider } from './toast-provider';

describe('OrderSettingsForm', () => {
  afterEach(() => vi.unstubAllGlobals());

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
