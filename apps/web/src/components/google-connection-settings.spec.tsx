import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleConnectionSettings } from './google-connection-settings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const active = {
  status: 'ACTIVE', email: 'owner@gmail.com', grantedScopes: ['drive.file'],
  connectedAt: '2026-09-03T06:00:00.000Z', lastVerifiedAt: '2026-09-03T06:00:00.000Z', lastErrorCode: null,
};

describe('GoogleConnectionSettings', () => {
  it('shows account details and disconnect controls only to the owner', () => {
    render(<GoogleConnectionSettings initial={active} role="OWNER" />);
    expect(screen.getByText('owner@gmail.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відключити Google' })).toBeInTheDocument();
  });

  it('shows a manager only safe connection health', () => {
    render(<GoogleConnectionSettings initial={{ ...active, email: null, grantedScopes: [] }} role="MANAGER" />);
    expect(screen.getByText('Google підключено')).toBeInTheDocument();
    expect(screen.queryByText('owner@gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['NOT_CONNECTED', 'Підключити Google'],
    ['REAUTHORIZATION_REQUIRED', 'Підключити повторно'],
    ['ERROR', 'Підключити повторно'],
  ])('offers the correct owner action for %s', (status, action) => {
    render(<GoogleConnectionSettings initial={{ ...active, status, email: null }} role="OWNER" />);
    expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
  });

  it('starts OAuth with CSRF protection and redirects to Google', async () => {
    const assign = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ authorizationUrl: 'https://accounts.google.com/oauth' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<GoogleConnectionSettings initial={{ ...active, status: 'NOT_CONNECTED', email: null }} role="OWNER" navigate={assign} />);

    fireEvent.click(screen.getByRole('button', { name: 'Підключити Google' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/oauth'));
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/google/connect', expect.objectContaining({ headers: expect.objectContaining({ 'x-csrf-token': 'csrf' }) }));
  });
});
