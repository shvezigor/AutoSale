import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoScenarioCard } from './demo-scenario-card';
import { I18nProvider } from '../i18n/i18n-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('DemoScenarioCard', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('starts the real processing pipeline and shows navigation links', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ eventId: 'event-1', duplicate: false }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoScenarioCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Запустити демосценарій' }));

    expect(await screen.findByText('Демодіалог передано на обробку')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити діалоги' })).toHaveAttribute('href', '/conversations');
    expect(screen.getByRole('link', { name: 'Відкрити замовлення' })).toHaveAttribute('href', '/orders');
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('/api/demo/order-scenario', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
    })));
  });

  it('explains that a repeated run reuses existing demo data', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ eventId: 'event-1', duplicate: true }) }));
    render(<DemoScenarioCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Запустити демосценарій' }));
    expect(await screen.findByText('Демосценарій уже був створений')).toBeInTheDocument();
  });
});
  it('renders the demo controls in English', () => {
    render(<I18nProvider locale="en" authenticated={false}><DemoScenarioCard /></I18nProvider>);
    expect(screen.getByRole('heading', { name: 'Demo scenario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run demo scenario' })).toBeInTheDocument();
    expect(screen.getByText(/Instagram/)).toBeInTheDocument();
  });
