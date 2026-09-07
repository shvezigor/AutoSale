import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createConversationOrder: vi.fn(),
  refreshConversationOrder: vi.fn(),
}));
vi.mock('../api/conversation-replies', () => api);

import { ConversationOrderPanel } from './conversation-order-panel';
import { ToastProvider } from './toast-provider';

afterEach(() => {
  cleanup();
  Object.values(api).forEach((mock) => mock.mockReset());
});

describe('ConversationOrderPanel', () => {
  it('lets a manager start AI recognition and opens the resulting order', async () => {
    api.createConversationOrder.mockResolvedValue({
      orderId: '22222222-2222-4222-8222-222222222222', queued: false,
    });
    render(<ToastProvider><ConversationOrderPanel
      conversationId="11111111-1111-4111-8111-111111111111"
      customerName="Олена"
      customerUsername="olena"
      initialState={{ order: null }}
    /></ToastProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Створити замовлення' }));

    await waitFor(() => expect(api.createConversationOrder).toHaveBeenCalled());
    expect(await screen.findByRole('link', { name: 'Відкрити замовлення' })).toHaveAttribute(
      'href', '/orders/22222222-2222-4222-8222-222222222222',
    );
  });
});
