import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { I18nProvider } from '../i18n/i18n-provider';
import { AdminIntegrations } from './admin-integrations';
import { ConfirmProvider } from './confirm-provider';

const { mutatingFetch } = vi.hoisted(() => ({ mutatingFetch: vi.fn() }));
vi.mock('../auth/csrf-fetch', () => ({ mutatingFetch }));

const controls = [
  {
    key: 'FACEBOOK_MESSENGER' as const,
    deploymentAvailable: true,
    runtimeEnabled: true,
    effectiveEnabled: true,
    state: 'ACTIVE' as const,
    updatedAt: '2026-10-04T10:00:00.000Z',
  },
  {
    key: 'TIKTOK_BUSINESS_MESSAGING' as const,
    deploymentAvailable: false,
    runtimeEnabled: false,
    effectiveEnabled: false,
    state: 'DEPLOYMENT_UNAVAILABLE' as const,
    updatedAt: null,
  },
];

afterEach(() => { cleanup(); mutatingFetch.mockReset(); });

function renderControls(locale: 'uk' | 'en' = 'uk') {
  return render(
    <I18nProvider locale={locale} authenticated>
      <ConfirmProvider><AdminIntegrations initialControls={controls} /></ConfirmProvider>
    </I18nProvider>,
  );
}

describe('AdminIntegrations', () => {
  it('renders localized privacy-safe channel states and no unavailable action', () => {
    renderControls();

    expect(screen.getByRole('heading', { name: 'Інтеграції каналів' })).toBeInTheDocument();
    expect(screen.getByText('Facebook Messenger')).toBeInTheDocument();
    expect(screen.getByText('Активний')).toBeInTheDocument();
    expect(screen.getByText('Недоступно в цьому розгортанні')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вимкнути' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TikTok.*увімкнути|Увімкнути.*TikTok/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secret|credential|tenantId|pageId|accountId/i);
  });

  it('uses an explicit warning before disabling and prevents duplicate mutations', async () => {
    let resolveRequest!: (response: Response) => void;
    mutatingFetch.mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Вимкнути' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Нові повідомлення та відповіді зупиняться');
    expect(screen.getByRole('dialog')).toHaveTextContent('Наявні дані залишаться');
    fireEvent.click(screen.getByRole('button', { name: 'Так, вимкнути' }));
    const action = await screen.findByRole('button', { name: 'Вимкнути' });
    expect(action).toBeDisabled();
    fireEvent.click(action);

    await waitFor(() => expect(mutatingFetch).toHaveBeenCalledTimes(1));
    expect(mutatingFetch).toHaveBeenCalledWith('/api/admin/integrations/FACEBOOK_MESSENGER', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    resolveRequest(new Response(JSON.stringify({
      ...controls[0], runtimeEnabled: false, effectiveEnabled: false, state: 'ADMIN_DISABLED',
    }), { status: 200 }));
    await waitFor(() => expect(screen.getByText('Вимкнено адміністратором')).toBeInTheDocument());
  });

  it('renders English and reports safe form-level mutation failures', async () => {
    mutatingFetch.mockResolvedValue(new Response(null, { status: 500 }));
    renderControls('en');

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disable' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the channel');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
  });
});
