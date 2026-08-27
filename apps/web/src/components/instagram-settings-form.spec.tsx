import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramSettingsForm } from './instagram-settings-form';

afterEach(() => vi.unstubAllGlobals());
describe('InstagramSettingsForm', () => {
  it('saves the professional account id with csrf', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ externalAccountId: '17841400000000000', displayName: 'Store', status: 'ACTIVE', updatedAt: '2026-08-27T00:00:00Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<InstagramSettingsForm initial={{ externalAccountId: null, displayName: null, status: 'NOT_CONFIGURED', updatedAt: null }} />);
    fireEvent.change(screen.getByLabelText('Instagram Account ID'), { target: { value: '17841400000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти Instagram' }));
    await waitFor(() => expect(screen.getByText('Instagram підключено')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/instagram', expect.objectContaining({ method: 'PATCH', headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }) }));
  });
});
