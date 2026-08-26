import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderSettingsForm } from './order-settings-form';

describe('OrderSettingsForm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves the selected approval mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <OrderSettingsForm
        initial={{
          approvalMode: 'ALWAYS',
          autoApprovalThreshold: 0.9,
          promptVersion: 'instagram-order-v1',
          triggerPhrases: ['беремо замовлення в роботу'],
        }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Без підтвердження'));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/settings/orders',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ approvalMode: 'NEVER' }),
        }),
      ),
    );
    expect(await screen.findByText('Налаштування збережено')).toBeInTheDocument();
  });
});
