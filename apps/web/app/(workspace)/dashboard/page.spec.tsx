import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authenticatedApiFetch } = vi.hoisted(() => ({ authenticatedApiFetch: vi.fn() }));
vi.mock('../../../src/auth/session', () => ({
  getServerSession: vi.fn().mockResolvedValue({ locale: 'uk' }),
  authenticatedApiFetch,
}));

import DashboardPage from './page';

const response = {
  generatedAt: '2026-09-17T07:00:00.000Z',
  period: { key: '30d', start: '2026-08-18T21:00:00.000Z', end: '2026-09-17T07:00:00.000Z', timezone: 'Europe/Kyiv' },
  metrics: {
    newOrders: { value: 18, previousValue: 12, changePercent: 50 },
    needsAttention: { value: 3, overdue: 1, review: 2, aiFailed: 1 },
    confirmationRate: { value: 0.75, numerator: 12, denominator: 16, previousValue: 0.6, changePercentagePoints: 15 },
    medianConfirmationMinutes: { value: 42, sampleSize: 8, previousValue: null, previousSampleSize: 0, changePercent: null },
  },
  dailyOrders: [{ date: '2026-09-17', confirmed: 2, needsReview: 1, processingOrFailed: 0, cancelled: 0 }],
  funnel: { created: 18, confirmed: 12, exported: null, shipmentStarted: 7, exportConfigured: false },
  queue: [],
  issues: { failedExports: 0, failedShipments: 0 },
  integrations: [],
};

describe('DashboardPage', () => {
  beforeEach(() => {
    authenticatedApiFetch.mockReset().mockResolvedValue({ ok: true, json: async () => response });
  });
  afterEach(cleanup);

  it('loads a real 30-day snapshot by default and exposes shareable period links', async () => {
    render(await DashboardPage({ searchParams: Promise.resolve({}) }));

    expect(authenticatedApiFetch).toHaveBeenCalledWith('/api/dashboard?period=30d');
    expect(screen.getByRole('heading', { name: 'Операційний огляд' })).toBeInTheDocument();
    expect(screen.queryByText('Демонстраційні дані')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7 днів' })).toHaveAttribute('href', '/dashboard?period=7d');
    expect(screen.getByRole('link', { name: '30 днів' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '90 днів' })).toHaveAttribute('href', '/dashboard?period=90d');
  });

  it('loads an allowlisted selected period and falls back from invalid input', async () => {
    const selected = render(await DashboardPage({ searchParams: Promise.resolve({ period: '7d' }) }));
    expect(authenticatedApiFetch).toHaveBeenLastCalledWith('/api/dashboard?period=7d');
    expect(screen.getByRole('link', { name: '7 днів' })).toHaveAttribute('aria-current', 'page');
    selected.unmount();

    render(await DashboardPage({ searchParams: Promise.resolve({ period: '365d' }) }));
    expect(authenticatedApiFetch).toHaveBeenLastCalledWith('/api/dashboard?period=30d');
  });
});
