import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleSignInButton } from './google-sign-in-button';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('GoogleSignInButton', () => {
  it('starts Google sign-in while preserving the supplied safe path', async () => {
    const fetchMock = vi.fn(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    render(<GoogleSignInButton returnPath="/catalogue" />);
    fireEvent.click(screen.getByRole('button', { name: 'Продовжити з Google' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/start', expect.objectContaining({ body: JSON.stringify({ returnPath: '/catalogue' }) })));
  });

  it('shows a neutral error for an untrusted authorization URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ authorizationUrl: 'https://example.com/phishing' }) })));
    render(<GoogleSignInButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Продовжити з Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не вдалося розпочати вхід через Google');
  });
});
