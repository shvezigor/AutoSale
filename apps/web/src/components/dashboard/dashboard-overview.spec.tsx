import type { DashboardResponse } from '../../../../../packages/contracts/src/dashboard';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createTranslator } from '../../i18n/translator';
import { DashboardOverview } from './dashboard-overview';

describe('DashboardOverview', () => {
  afterEach(cleanup);

  it('exports the dashboard overview component', async () => {
    const module = await import('./dashboard-overview.js').catch(() => ({}));
    expect(module).toHaveProperty('DashboardOverview');
  });

  it('prioritizes the queue and renders metric-aware comparisons', () => {
    render(<DashboardOverview locale="uk" metrics={metrics()} t={createTranslator('uk')} />);

    expect(screen.getByRole('heading', { name: 'У черзі на перевірку: 3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити чергу' })).toHaveAttribute('href', '/orders?status=NEEDS_REVIEW');
    expect(screen.getByRole('link', { name: 'Помилки AI: 1' })).toHaveAttribute('href', '/orders?status=AI_FAILED');
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('42 хв')).toBeInTheDocument();
    expect(screen.getByText('+50%')).toHaveAttribute('data-tone', 'positive');
    expect(screen.getByText('−50%')).toHaveAttribute('data-tone', 'positive');
  });

  it('omits attention guidance and displays unavailable values without inventing zeroes', () => {
    const empty = metrics();
    empty.needsAttention = { value: 0, overdue: 0, review: 0, aiFailed: 0 };
    empty.confirmationRate = { value: null, numerator: 0, denominator: 0, previousValue: null, changePercentagePoints: null };
    empty.medianConfirmationMinutes = { value: null, sampleSize: 0, previousValue: null, previousSampleSize: 0, changePercent: null };

    render(<DashboardOverview locale="uk" metrics={empty} t={createTranslator('uk')} />);

    expect(screen.queryByText('Потребує уваги')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByText('Недостатньо даних для порівняння')).toHaveLength(2);
  });
});

function metrics(): DashboardResponse['metrics'] {
  return {
    newOrders: { value: 18, previousValue: 12, changePercent: 50 },
    needsAttention: { value: 3, overdue: 1, review: 2, aiFailed: 1 },
    confirmationRate: { value: 0.75, numerator: 12, denominator: 16, previousValue: 0.6, changePercentagePoints: 15 },
    medianConfirmationMinutes: { value: 42, sampleSize: 8, previousValue: 84, previousSampleSize: 4, changePercent: -50 },
  };
}
